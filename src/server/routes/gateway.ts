import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJson } from '../http.js';
import { route, type Route } from '../router.js';
import { DEFAULT_PROVIDER_MODEL } from '#lib/config';
import { nextDailyRun, parseLocalTime } from '#lib/server/util/cron';
import { getChannelRegistry } from '#lib/server/capabilities/channel-registry';
import { emitControlPlaneEvent, subscribeControlPlane } from '#lib/server/runtime/control-plane';
import { getContextSourceRegistry } from '#lib/server/capabilities/context-source-registry';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getGateway } from '#lib/server/runtime/gateway';
import { getGatewaySnapshot } from '#lib/server/runtime/snapshot';
import { getNotionStatus } from '#lib/server/context-sources/notion';
import { listPluginStatuses, listRegisteredPluginManifests } from '#lib/server/capabilities/plugins';
import { loadPolicyProfiles } from '../../lib/server/policies/loader.js';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import {
  buildUserPolicyProfile,
  builtinPolicyProfile,
  resolveEffectivePolicy
} from '#lib/server/runtime/policy-compiler';
import { loadSkills } from '#lib/server/skills/loader';
import { getStore } from '#lib/server/persistence/store';
import { getToolRegistry } from '#lib/server/capabilities/tool-registry';
import type { ChannelEnsureMemberResult, SessionMode } from '#lib/types';

const gateway = getGateway();

function channelLabel(channel: { id: string; name?: string }): string {
  return channel.name ? `#${channel.name}` : channel.id;
}

function inviteAction(channel: { id: string; name?: string }): string {
  return `/invite @TZBot in ${channelLabel(channel)}`;
}

async function resolveProfileSelection(
  mode: SessionMode,
  workspaceId?: string,
  explicitProfileName?: string,
  userProfileName?: string
) {
  const profiles = await loadPolicyProfiles();
  const store = getStore();
  const workspaceMemory = workspaceId ? store.getOrCreateWorkspaceMemory(workspaceId) : undefined;
  const selectedName =
    explicitProfileName || userProfileName || workspaceMemory?.defaultPolicyProfileName;
  const selectedProfile = selectedName
    ? profiles.find((profile) => profile.name === selectedName)
    : undefined;

  return {
    profiles,
    selectedProfile: selectedProfile ?? builtinPolicyProfile(mode)
  };
}

async function handleSse(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });

  const writeEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  writeEvent('ready', { ok: true });

  const unsubscribe = subscribeControlPlane((event) => {
    writeEvent(event.type, event);
  });
  const keepAlive = setInterval(() => {
    writeEvent('ping', {});
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
}

export const gatewayRoutes: Route[] = [
  route('GET', '/api/gateway/summary', async ({ res }) => {
    sendJson(res, await getGatewaySnapshot());
  }),
  route('GET', '/api/gateway/policy-profiles', async ({ res }) => {
    sendJson(res, { profiles: await loadPolicyProfiles() });
  }),
  route('POST', '/api/gateway/policy/preview', async ({ req, res }) => {
    const body = await readJson<{
      workspaceId?: string;
      profileName?: string;
      userProfileName?: string;
      overrideRaw?: string;
      sessionMode?: SessionMode;
    }>(req);
    const mode = body.sessionMode ?? 'manual_review';
    const { profiles, selectedProfile } = await resolveProfileSelection(
      mode,
      body.workspaceId,
      body.profileName,
      body.userProfileName
    );
    const effective = resolveEffectivePolicy({
      mode,
      baseProfile: selectedProfile,
      overrideRaw: body.overrideRaw
    });
    sendJson(res, {
      ok: true,
      profiles,
      selectedProfileName: selectedProfile.name,
      compiled: effective.compiled,
      warnings: effective.warnings
    });
  }),
  route('GET', '/api/gateway/events', ({ req, res }) => handleSse(req, res)),
  route('GET', '/api/gateway/runtime', async ({ res }) => {
    await ensureRuntimeInitialized();
    const store = getStore();
    const workspace = store.getFirstWorkspace();
    const workspaceMemory = workspace ? store.getOrCreateWorkspaceMemory(workspace.id) : undefined;
    const env = getRuntimeEnv();

    sendJson(res, {
      channels: getChannelRegistry().list(),
      contextSources: getContextSourceRegistry().list(),
      tools: getToolRegistry().list(),
      plugins: listRegisteredPluginManifests(),
      provider: {
        defaultProvider: env.defaultProvider,
        defaultModels: DEFAULT_PROVIDER_MODEL,
        configured: Boolean(env.openaiApiKey || env.anthropicApiKey)
      },
      capabilityStatuses: [
        {
          id: 'notion',
          kind: 'builtin',
          name: 'Notion',
          status: getNotionStatus().configured ? 'loaded' : 'misconfigured',
          error: getNotionStatus().configured ? undefined : 'NOTION_API_KEY is not configured',
          capabilities: {
            channels: [],
            tools: getNotionStatus().configured ? ['notion.search', 'notion.read_page'] : [],
            contextSources: getNotionStatus().configured ? ['notion.thread_search'] : [],
            skills: ['documentation-grounded-continuity'],
            providers: []
          }
        },
        ...listPluginStatuses()
      ],
      skills: await loadSkills(),
      enabledOptionalTools: workspaceMemory?.enabledOptionalTools ?? [],
      enabledContextSources: workspaceMemory?.enabledContextSources ?? [],
      enabledPlugins: workspaceMemory?.enabledPlugins ?? [],
      defaultPolicyProfileName: workspaceMemory?.defaultPolicyProfileName
    });
  }),
  route('PUT', '/api/gateway/workspace-memory', async ({ req, res }) => {
    const body = await readJson<{
      workspaceId?: string;
      enabledOptionalTools?: unknown;
      enabledContextSources?: unknown;
      enabledPlugins?: unknown;
      defaultPolicyProfileName?: unknown;
    }>(req);
    const store = getStore();
    const workspace =
      (body.workspaceId ? store.getWorkspaceById(body.workspaceId) : undefined) ?? store.getFirstWorkspace();

    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_not_installed' }, 400);
      return;
    }

    const existing = store.getOrCreateWorkspaceMemory(workspace.id);
    const next = {
      ...existing,
      enabledOptionalTools: Array.isArray(body.enabledOptionalTools)
        ? body.enabledOptionalTools.filter((value): value is string => typeof value === 'string')
        : existing.enabledOptionalTools,
      enabledContextSources: Array.isArray(body.enabledContextSources)
        ? body.enabledContextSources.filter((value): value is string => typeof value === 'string')
        : existing.enabledContextSources,
      enabledPlugins: Array.isArray(body.enabledPlugins)
        ? body.enabledPlugins.filter((value): value is string => typeof value === 'string')
        : existing.enabledPlugins,
      defaultPolicyProfileName:
        typeof body.defaultPolicyProfileName === 'string'
          ? body.defaultPolicyProfileName.trim() || undefined
          : existing.defaultPolicyProfileName
    };

    store.upsertWorkspaceMemory(next);
    sendJson(res, { ok: true, workspaceMemory: next });
  }),
  route('GET', '/api/gateway/audit', ({ res, url }) => {
    sendJson(res, {
      records: getStore().listAudit(
        url.searchParams.get('workspaceId') ?? undefined,
        Number(url.searchParams.get('limit') ?? 50)
      )
    });
  }),
  route('GET', '/api/gateway/traces', ({ res, url }) => {
    sendJson(res, {
      traces: getStore().listRunSummaries(
        url.searchParams.get('sessionId') ?? undefined,
        Number(url.searchParams.get('limit') ?? 50)
      )
    });
  }),
  route('GET', '/api/gateway/runs', ({ res, url }) => {
    sendJson(res, {
      runs: getStore().listAgentRuns(
        url.searchParams.get('sessionId') ?? undefined,
        Number(url.searchParams.get('limit') ?? 50)
      )
    });
  }),
  route('GET', '/api/gateway/runs/:id', ({ res, params }) => {
    const run = getStore().getAgentRun(params.id);
    if (!run) {
      sendJson(res, { ok: false, error: 'not_found' }, 404);
      return;
    }

    sendJson(res, { run });
  }),
  route('GET', '/api/gateway/runs/:id/events', ({ res, params }) => {
    const run = getStore().getAgentRun(params.id);
    if (!run) {
      sendJson(res, { ok: false, error: 'not_found' }, 404);
      return;
    }

    sendJson(res, { events: getStore().listAgentRunEvents(params.id) });
  }),
  route('GET', '/api/gateway/queue', ({ res, url }) => {
    sendJson(res, {
      queue: getStore().listReviewQueue(
        url.searchParams.get('workspaceId') ?? undefined,
        url.searchParams.get('sessionId') ?? undefined
      )
    });
  }),
  route('PUT', '/api/gateway/users/:userId/schedule', async ({ req, res, params }) => {
    const body = await readJson<{
      workspaceId?: string;
      displayName?: string;
      timezone?: string;
      workdayStartHour?: number;
      workdayEndHour?: number;
    }>(req);
    const store = getStore();
    const workspace =
      (body.workspaceId ? store.getWorkspaceById(body.workspaceId) : undefined) ?? store.getFirstWorkspace();

    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_not_installed' }, 400);
      return;
    }

    const user = store.upsertUser({
      workspaceId: workspace.id,
      externalUserId: params.userId,
      displayName: body.displayName ?? params.userId,
      timezone: body.timezone,
      workdayStartHour: body.workdayStartHour,
      workdayEndHour: body.workdayEndHour
    });
    sendJson(res, { ok: true, user });
  }),
  route('GET', '/api/gateway/users/:userId/policy', ({ res, params, url }) => {
    const store = getStore();
    const workspace =
      (url.searchParams.get('workspaceId')
        ? store.getWorkspaceById(url.searchParams.get('workspaceId')!)
        : undefined) ?? store.getFirstWorkspace();

    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_not_installed' }, 400);
      return;
    }

    const memory = store.getOrCreateUserMemory(workspace.id, params.userId);
    sendJson(res, { ok: true, policy: memory.policy ?? null });
  }),
  route('PUT', '/api/gateway/users/:userId/policy', async ({ req, res, params }) => {
    const body = await readJson<{
      workspaceId?: string;
      profileName?: string;
      overrideRaw?: string;
      sessionMode?: SessionMode;
    }>(req);
    const store = getStore();
    const workspace =
      (body.workspaceId ? store.getWorkspaceById(body.workspaceId) : undefined) ?? store.getFirstWorkspace();

    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_not_installed' }, 400);
      return;
    }

    const existing = store.getOrCreateUserMemory(workspace.id, params.userId);
    const mode = body.sessionMode ?? 'manual_review';
    const { selectedProfile } = await resolveProfileSelection(
      mode,
      workspace.id,
      body.profileName,
      existing.policy?.profileName
    );
    const effective = resolveEffectivePolicy({
      mode,
      baseProfile: selectedProfile,
      overrideRaw: body.overrideRaw ?? existing.policy?.overrideRaw
    });
    const profile = buildUserPolicyProfile({
      mode,
      profileName: selectedProfile.source === 'builtin' ? undefined : selectedProfile.name,
      overrideRaw: body.overrideRaw ?? existing.policy?.overrideRaw,
      compiled: effective.compiled,
      source:
        (body.overrideRaw ?? existing.policy?.overrideRaw)?.trim()
          ? 'operator_prompt'
          : selectedProfile.source === 'builtin'
            ? 'default'
            : 'profile'
    });
    store.upsertUserMemory(workspace.id, params.userId, {
      ...existing,
      forbiddenTopics: [],
      policy: profile
    });
    sendJson(res, { ok: true, policy: profile });
  }),
  route('GET', '/api/gateway/recurring-jobs', ({ res, url }) => {
    sendJson(res, {
      jobs: getStore().listRecurringJobs(url.searchParams.get('sessionId') ?? undefined)
    });
  }),
  route('POST', '/api/gateway/recurring-jobs', async ({ req, res }) => {
    const body = await readJson<{
      workspaceId?: string;
      sessionId?: string;
      channelId?: string;
      ownerUserId?: string;
      ownerSlackUserId?: string;
      localTime?: string;
      timezone?: string;
    }>(req);
    const store = getStore();
    const workspace =
      (body.workspaceId ? store.getWorkspaceById(body.workspaceId) : undefined) ?? store.getFirstWorkspace();
    const session = body.sessionId ? store.getSessionById(body.sessionId) : undefined;

    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_not_installed' }, 400);
      return;
    }

    if (body.sessionId && !session) {
      sendJson(res, { ok: false, error: 'session_not_found' }, 404);
      return;
    }

    const ownerUserId = body.ownerUserId ?? body.ownerSlackUserId;
    if (!body.channelId || !ownerUserId) {
      sendJson(res, { ok: false, error: 'channel_and_owner_required' }, 400);
      return;
    }

    const localTime = body.localTime ?? '08:30';
    try {
      parseLocalTime(localTime);
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'invalid_local_time' }, 400);
      return;
    }

    const timezone = body.timezone ?? 'America/Los_Angeles';
    const job = store.createRecurringJob({
      workspaceId: workspace.id,
      sessionId: session?.id ?? body.sessionId,
      jobType: 'morning_digest',
      localTime,
      timezone,
      payload: {
        channelId: body.channelId,
        ownerUserId
      },
      nextRunAt: nextDailyRun(localTime, timezone).toISOString()
    });

    sendJson(res, { ok: true, job }, 201);
  }),
  route('DELETE', '/api/gateway/recurring-jobs/:id', ({ res, params }) => {
    sendJson(res, { ok: getStore().deleteRecurringJob(params.id) });
  }),
  route('POST', '/api/gateway/queue/:id', async ({ req, res, params }) => {
    const body = await readJson<{
      action?: 'approve_send' | 'edit_send' | 'reject' | 'mark_abstain';
      message?: string;
      reason?: string;
    }>(req);

    if (!body.action) {
      sendJson(res, { ok: false, error: 'action_required' }, 400);
      return;
    }

    try {
      const item = await gateway.handleReviewAction(params.id, {
        action: body.action,
        message: body.message,
        reason: body.reason
      });
      sendJson(res, { ok: true, item });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'review_action_failed' }, 400);
    }
  }),
  route('GET', '/api/gateway/sessions', ({ res, url }) => {
    sendJson(res, {
      sessions: getStore().listActiveSessions(url.searchParams.get('workspaceId') ?? undefined)
    });
  }),
  route('POST', '/api/gateway/sessions', async ({ req, res }) => {
    await ensureRuntimeInitialized();
    const body = await readJson<{
      workspaceId?: string;
      ownerUserId?: string;
      ownerSlackUserId?: string;
      title?: string;
      mode?: SessionMode;
      channelScope?: string[];
      durationHours?: number;
      policyProfileName?: string;
      policyOverrideRaw?: string;
    }>(req);
    const store = getStore();
    const workspace =
      (body.workspaceId ? store.getWorkspaceById(body.workspaceId) : undefined) ?? store.getFirstWorkspace();

    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_not_installed' }, 400);
      return;
    }

    const ownerUserId = body.ownerUserId ?? body.ownerSlackUserId;
    if (!ownerUserId) {
      sendJson(res, { ok: false, error: 'owner_required' }, 400);
      return;
    }

    const channelScope = body.channelScope ?? [];
    const membershipResults: ChannelEnsureMemberResult[] = [];

    for (const channelId of channelScope) {
      membershipResults.push(await getChannelRegistry().ensureMember(workspace, workspace.provider, channelId));
    }

    const autoJoined = membershipResults
      .filter((result) => result.status === 'joined')
      .map((result) => ({ id: result.channelId, name: result.name }));
    const requiresInvitation = membershipResults
      .filter((result) => result.status === 'requires_invitation')
      .map((result) => ({
        id: result.channelId,
        name: result.name,
        action: inviteAction({ id: result.channelId, name: result.name })
      }));
    const reinstallRequired = membershipResults.some((result) => result.status === 'reinstall_required');
    const errors = membershipResults
      .filter((result) => result.status === 'error')
      .map((result) => ({
        id: result.channelId,
        name: result.name,
        reason: result.reason ?? 'Channel membership check failed'
      }));

    if (requiresInvitation.length > 0 || reinstallRequired || errors.length > 0) {
      sendJson(
        res,
        {
          ok: false,
          error: 'channels_require_action',
          autoJoined,
          requiresInvitation,
          reinstallRequired,
          errors
        },
        409
      );
      return;
    }

    store.upsertUser({
      workspaceId: workspace.id,
      externalUserId: ownerUserId,
      displayName: ownerUserId
    });
    const existingMemory = store.getOrCreateUserMemory(workspace.id, ownerUserId);
    const mode = body.mode ?? 'manual_review';
    const { selectedProfile } = await resolveProfileSelection(
      mode,
      workspace.id,
      body.policyProfileName,
      existingMemory.policy?.profileName
    );
    const effective = resolveEffectivePolicy({
      mode,
      baseProfile: selectedProfile,
      overrideRaw: body.policyOverrideRaw
    });
    const policyProfile = buildUserPolicyProfile({
      mode,
      profileName: selectedProfile.source === 'builtin' ? undefined : selectedProfile.name,
      overrideRaw: body.policyOverrideRaw,
      compiled: effective.compiled,
      source:
        body.policyOverrideRaw?.trim()
          ? 'operator_prompt'
          : selectedProfile.source === 'builtin'
            ? 'default'
            : 'profile'
    });
    store.upsertUserMemory(workspace.id, ownerUserId, {
      ...existingMemory,
      forbiddenTopics: [],
      policy: policyProfile
    });

    const session = store.createSession({
      workspaceId: workspace.id,
      ownerUserId,
      title: body.title?.trim() || 'Overnight autopilot',
      mode,
      channelScope,
      policyProfileName: policyProfile.profileName,
      policyOverrideRaw: policyProfile.overrideRaw,
      policy: policyProfile,
      endsAt: new Date(Date.now() + Math.max(1, body.durationHours ?? 10) * 60 * 60 * 1000).toISOString()
    });
    emitControlPlaneEvent({ type: 'session.updated', session });

    sendJson(res, { ok: true, session, autoJoined }, 201);
  }),
  route('GET', '/api/gateway/sessions/:id', ({ res, params }) => {
    const session = getStore().getSessionById(params.id);
    if (!session) {
      sendJson(res, { ok: false, error: 'not_found' }, 404);
      return;
    }

    sendJson(res, {
      session,
      briefing: getStore().getMorningBriefing(params.id)
    });
  }),
  route('POST', '/api/gateway/sessions/:id/stop', ({ res, params }) => {
    const store = getStore();
    const existing = store.getSessionById(params.id);

    if (!existing) {
      sendJson(res, { ok: false, error: 'not_found' }, 404);
      return;
    }

    store.stopSession(params.id);
    const session = store.getSessionById(params.id);

    if (session) {
      emitControlPlaneEvent({ type: 'session.updated', session });
      emitControlPlaneEvent({ type: 'briefing.ready', sessionId: session.id });
    }

    sendJson(res, {
      ok: true,
      session,
      briefing: getStore().getMorningBriefing(params.id)
    });
  })
];
