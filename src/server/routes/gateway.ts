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
import { loadPolicyProfiles, normalizePolicyProfileName } from '../../lib/server/policies/loader.js';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import {
  buildUserPolicyProfile,
  builtinPolicyProfile,
  normalizePolicyExecutionMode,
  resolveEffectivePolicy
} from '#lib/server/runtime/policy-compiler';
import { loadSkills } from '#lib/server/skills/loader';
import { getStore } from '#lib/server/persistence/store';
import { getSlackService } from '#lib/server/channels/slack/service';
import { requireMatchingSetupOwner } from '#lib/server/setup/owner-identity';
import { getToolRegistry } from '#lib/server/capabilities/tool-registry';
import { readMurphConfig, updateMurphPolicyConfig } from '#lib/server/setup/config-file';
import { refreshRuntimeState } from '#lib/server/runtime/refresh';
import type {
  AgentUser,
  ChannelEnsureMemberResult,
  ChannelSetupMember,
  PolicyExecutionMode,
  SessionMode,
  Workspace,
  WorkspaceSubscriptionChannelScopeMode,
  WorkspaceSubscriptionStatus
} from '#lib/types';

const gateway = getGateway();

function channelLabel(channel: { id: string; name?: string }): string {
  return channel.name ? `#${channel.name}` : channel.id;
}

function inviteAction(channel: { id: string; name?: string }): string {
  return `/invite @TZBot in ${channelLabel(channel)}`;
}

function resolveRequestWorkspace(workspaceId?: string): Workspace | undefined {
  const store = getStore();
  const slack = getSlackService();
  const workspace = workspaceId
    ? store.getWorkspaceById(workspaceId)
    : slack.getUsableWorkspace() ?? store.getFirstWorkspace();

  if (workspace?.provider === 'slack' && !slack.canReadBotToken(workspace)) {
    return undefined;
  }

  return workspace;
}

type SessionCreateInput = {
  workspaceId?: string;
  ownerUserId?: string;
  title?: string;
  mode?: SessionMode;
  channelScope?: string[];
  durationHours?: number;
  stopLocalTime?: string;
  timezone?: string;
};

type PreparedSessionTarget = {
  workspace: Workspace;
  ownerUserId: string;
  ownerMember: ChannelSetupMember;
  channelScope: string[];
  autoJoined: Array<{ id: string; name?: string }>;
};

function sessionModeFromPolicyMode(mode: PolicyExecutionMode): SessionMode {
  return mode;
}

function effectivePolicyMode(profileMode: PolicyExecutionMode): PolicyExecutionMode {
  return readMurphConfig().policy?.mode ?? profileMode;
}

function resolveSessionMode(inputMode: SessionMode | undefined, policyMode: PolicyExecutionMode): SessionMode {
  if (!inputMode) return sessionModeFromPolicyMode(policyMode);
  if (inputMode === 'dry_run') return 'dry_run';
  if (inputMode === 'manual_review') return 'manual_review';
  return policyMode === 'auto_send_low_risk' ? 'auto_send_low_risk' : 'manual_review';
}

function workspaceDescriptor(workspace: Workspace) {
  return {
    id: workspace.id,
    provider: workspace.provider,
    name: workspace.name
  };
}

function normalizeSubscriptionStatus(value: unknown): WorkspaceSubscriptionStatus | undefined {
  return value === 'active' || value === 'paused' ? value : undefined;
}

function normalizeChannelScopeMode(value: unknown): WorkspaceSubscriptionChannelScopeMode | undefined {
  return value === 'selected' || value === 'all_accessible' ? value : undefined;
}

function channelScopeFromBody(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean))]
    : undefined;
}

function updateConfirmedChannels(
  workspace: Workspace,
  channelScope: string[],
  membershipResults: ChannelEnsureMemberResult[]
): void {
  if (channelScope.length === 0 || membershipResults.length === 0) {
    return;
  }

  const store = getStore();
  const scoped = new Set(channelScope);
  const confirmed = new Set(
    membershipResults
      .filter((result) => result.status === 'already_member' || result.status === 'joined')
      .map((result) => result.channelId)
  );
  const workspaceMemory = store.getOrCreateWorkspaceMemory(workspace.id);
  workspaceMemory.confirmedChannels = [
    ...(workspaceMemory.confirmedChannels ?? []).filter((channelId) => !scoped.has(channelId)),
    ...confirmed
  ];
  store.upsertWorkspaceMemory(workspaceMemory);
}

function resolveSessionEndsAt(input: SessionCreateInput, user: AgentUser): string {
  if (input.stopLocalTime || input.timezone) {
    const timezone = input.timezone?.trim() || user.schedule.timezone;
    const stopLocalTime =
      input.stopLocalTime?.trim() || `${String(user.schedule.workdayStartHour).padStart(2, '0')}:00`;
    parseLocalTime(stopLocalTime);
    return nextDailyRun(stopLocalTime, timezone).toISOString();
  }

  if (input.durationHours !== undefined) {
    return new Date(Date.now() + Math.max(1, input.durationHours) * 60 * 60 * 1000).toISOString();
  }

  const stopLocalTime = `${String(user.schedule.workdayStartHour).padStart(2, '0')}:00`;
  return nextDailyRun(stopLocalTime, user.schedule.timezone).toISOString();
}

async function prepareSessionTarget(input: SessionCreateInput): Promise<
  | { ok: true; target: PreparedSessionTarget }
  | { ok: false; status: number; payload: Record<string, unknown> }
> {
  const workspace = resolveRequestWorkspace(input.workspaceId);

  if (!workspace) {
    return {
      ok: false,
      status: 400,
      payload: {
        ok: false,
        error: getSlackService().hasUnreadableInstall() ? 'slack_reconnect_required' : 'workspace_not_installed',
        workspaceId: input.workspaceId
      }
    };
  }

  const ownerUserId = input.ownerUserId;
  if (!ownerUserId) {
    return { ok: false, status: 400, payload: { ok: false, error: 'owner_required', workspace: workspaceDescriptor(workspace) } };
  }

  const store = getStore();
  const existingSubscription = store.getWorkspaceSubscription(workspace.id, ownerUserId);
  if (existingSubscription?.status !== 'active') {
    return {
      ok: false,
      status: 403,
      payload: {
        ok: false,
        error: 'subscription_required',
        workspace: workspaceDescriptor(workspace),
        ownerUserId
      }
    };
  }

  const requestedChannelScope = input.channelScope ?? [];
  if (!store.subscriptionAllowsChannelScope(existingSubscription, requestedChannelScope)) {
    return {
      ok: false,
      status: 403,
      payload: {
        ok: false,
        error: 'subscription_channel_scope_mismatch',
        workspace: workspaceDescriptor(workspace),
        ownerUserId,
        channelScope: requestedChannelScope
      }
    };
  }

  let ownerMember: ChannelSetupMember;
  try {
    ownerMember = await getChannelRegistry().getMember(workspace, ownerUserId);
  } catch (error) {
    return {
      ok: false,
      status: 400,
      payload: {
        ok: false,
        error: 'owner_not_found',
        workspace: workspaceDescriptor(workspace),
        ownerUserId,
        message: error instanceof Error ? error.message : 'Owner user was not found in this workspace'
      }
    };
  }

  const channelScope = input.channelScope ?? [];
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
    updateConfirmedChannels(workspace, channelScope, membershipResults);
    return {
      ok: false,
      status: 409,
      payload: {
        ok: false,
        error: 'channels_require_action',
        workspace: workspaceDescriptor(workspace),
        autoJoined,
        requiresInvitation,
        reinstallRequired,
        errors
      }
    };
  }

  updateConfirmedChannels(workspace, channelScope, membershipResults);

  return {
    ok: true,
    target: {
      workspace,
      ownerUserId,
      ownerMember,
      channelScope,
      autoJoined
    }
  };
}

async function createPreparedSession(target: PreparedSessionTarget, input: SessionCreateInput) {
  const store = getStore();
  const user = store.upsertUser({
    workspaceId: target.workspace.id,
    externalUserId: target.ownerUserId,
    displayName: target.ownerMember.displayName || target.ownerUserId
  });
  const { selectedProfile } = await resolveProfileSelection();
  const policyMode = effectivePolicyMode(selectedProfile.compiled.executionMode);
  const mode = resolveSessionMode(input.mode, policyMode);
  const effective = resolveEffectivePolicy({
    mode,
    executionMode: policyMode,
    baseProfile: selectedProfile
  });
  const policyProfile = buildUserPolicyProfile({
    mode,
    profileName: selectedProfile.source === 'builtin' ? undefined : selectedProfile.name,
    compiled: effective.compiled,
    source: selectedProfile.source === 'builtin' ? 'default' : 'profile'
  });

  const session = store.createSession({
    workspaceId: target.workspace.id,
    ownerUserId: target.ownerUserId,
    title: input.title?.trim() || 'Overnight autopilot',
    mode,
    channelScope: target.channelScope,
    policyProfileName: policyProfile.profileName,
    policyOverrideRaw: policyProfile.overrideRaw,
    policy: policyProfile,
    policyBinding: input.mode ? 'explicit' : 'config',
    channelScopeBinding: input.channelScope ? 'explicit' : 'setup_defaults',
    endsAt: resolveSessionEndsAt(input, user)
  });
  emitControlPlaneEvent({ type: 'session.updated', session });
  gateway.reconcileSessionExpirations();
  return session;
}

async function resolveProfileSelection(
  explicitProfileName?: string
) {
  const profiles = await loadPolicyProfiles();
  const store = getStore();
  const selectedName = normalizePolicyProfileName(
    explicitProfileName || readMurphConfig().policy?.profile || store.getAppSettings().policyProfileName
  );
  const selectedProfile = selectedName
    ? profiles.find((profile) => profile.name === selectedName)
    : undefined;

  return {
    profiles,
    selectedProfile: selectedProfile ?? builtinPolicyProfile('manual_review')
  };
}

async function policyConfigPayload(mode?: PolicyExecutionMode) {
  const store = getStore();
  const settings = store.getAppSettings();
  const config = readMurphConfig();
  const configProfileName = config.policy?.profile;
  const { profiles, selectedProfile } = await resolveProfileSelection();
  const policyMode = mode ?? config.policy?.mode ?? selectedProfile.compiled.executionMode;
  const effective = resolveEffectivePolicy({
    mode: sessionModeFromPolicyMode(policyMode),
    executionMode: policyMode,
    baseProfile: selectedProfile
  });

  return {
    ok: true,
    profiles,
    policyProfileName: normalizePolicyProfileName(configProfileName || settings.policyProfileName),
    mode: policyMode,
    selectedProfileName: selectedProfile.name,
    selectedProfile,
    compiled: effective.compiled
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
    gateway.reconcileSessionExpirations();
    sendJson(res, await getGatewaySnapshot());
  }),
  route('GET', '/api/gateway/policy-profiles', async ({ res }) => {
    sendJson(res, { profiles: await loadPolicyProfiles() });
  }),
  route('GET', '/api/gateway/policy/config', async ({ res }) => {
    sendJson(res, await policyConfigPayload());
  }),
  route('PUT', '/api/gateway/policy/config', async ({ req, res }) => {
    const body = await readJson<{ profileName?: unknown; mode?: unknown }>(req);
    const profileName = typeof body.profileName === 'string'
      ? normalizePolicyProfileName(body.profileName)
      : undefined;
    const mode = body.mode === undefined ? undefined : normalizePolicyExecutionMode(body.mode);
    const profiles = await loadPolicyProfiles();

    if (profileName && !profiles.some((profile) => profile.name === profileName)) {
      sendJson(res, { ok: false, error: 'unknown_policy_profile' }, 400);
      return;
    }
    if (body.mode !== undefined && !mode) {
      sendJson(res, { ok: false, error: 'invalid_policy_mode' }, 400);
      return;
    }

    updateMurphPolicyConfig({
      ...(Object.prototype.hasOwnProperty.call(body, 'profileName') ? { profileName } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, 'mode') ? { mode } : {})
    });
    const refresh = await refreshRuntimeState({
      reason: 'policy_config_updated',
      deferIfRunActive: true
    });
    sendJson(res, { ...(await policyConfigPayload()), refresh });
  }),
  route('POST', '/api/gateway/policy/preview', async ({ req, res }) => {
    const body = await readJson<{
      profileName?: string;
      mode?: string;
      overrideRaw?: string;
      scopedRules?: unknown;
      sessionMode?: SessionMode;
    }>(req);
    const { profiles, selectedProfile } = await resolveProfileSelection(body.profileName);
    const policyMode =
      normalizePolicyExecutionMode(body.mode) ??
      effectivePolicyMode(selectedProfile.compiled.executionMode);
    const sessionMode = body.sessionMode
      ? resolveSessionMode(body.sessionMode, policyMode)
      : sessionModeFromPolicyMode(policyMode);
    const effective = resolveEffectivePolicy({
      mode: sessionMode,
      executionMode: policyMode,
      baseProfile: selectedProfile,
      overrideRaw: body.overrideRaw,
      scopedRules: body.scopedRules
    });
    sendJson(res, {
      ok: true,
      profiles,
      mode: policyMode,
      sessionMode,
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
        defaultModel: env.defaultModel,
        policyProvider: env.policyProvider,
        policyModel: env.policyModel,
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
            skills: ['notion-docs'],
            providers: []
          }
        },
        ...listPluginStatuses()
      ],
      skills: await loadSkills(),
      enabledOptionalTools: workspaceMemory?.enabledOptionalTools ?? [],
      enabledContextSources: workspaceMemory?.enabledContextSources ?? [],
      enabledPlugins: workspaceMemory?.enabledPlugins ?? []
    });
  }),
  route('PUT', '/api/gateway/workspace-memory', async ({ req, res }) => {
    const body = await readJson<{
      workspaceId?: string;
      enabledOptionalTools?: unknown;
      enabledContextSources?: unknown;
      enabledPlugins?: unknown;
    }>(req);
    const store = getStore();
    const workspace = resolveRequestWorkspace(body.workspaceId);

    if (!workspace) {
      sendJson(res, {
        ok: false,
        error: getSlackService().hasUnreadableInstall() ? 'slack_reconnect_required' : 'workspace_not_installed'
      }, 400);
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
        : existing.enabledPlugins
    };

    store.upsertWorkspaceMemory(next);
    const refresh = await refreshRuntimeState({
      reason: 'workspace_capabilities_updated',
      workspaceIds: [workspace.id],
      deferIfRunActive: true
    });
    sendJson(res, { ok: true, workspaceMemory: next, refresh });
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
  route('GET', '/api/gateway/triage', ({ res, url }) => {
    const store = getStore();
    const workspaceId = url.searchParams.get('workspaceId') ?? undefined;
    const requestedSessionId = url.searchParams.get('sessionId') ?? undefined;
    const sessions = store.listCompletedSessions(workspaceId, 20);
    const triageCounts = store.countTriageItemsBySession(workspaceId, sessions.map((completedSession) => completedSession.id));
    const session = requestedSessionId
      ? store.getSessionById(requestedSessionId)
      : sessions[0];

    if (requestedSessionId && (!session || (workspaceId && session.workspaceId !== workspaceId))) {
      sendJson(res, { ok: false, error: 'not_found' }, 404);
      return;
    }

    sendJson(res, {
      session: session ?? null,
      sessions: sessions.map((completedSession) => ({
        ...completedSession,
        triageItemCount: triageCounts.get(completedSession.id) ?? 0
      })),
      items: session ? store.listTriageItems(workspaceId, session.id) : []
    });
  }),
  route('GET', '/api/gateway/queue', ({ res, url }) => {
    sendJson(res, {
      queue: getStore().listReviewQueue(
        url.searchParams.get('workspaceId') ?? undefined,
        url.searchParams.get('sessionId') ?? undefined
      )
    });
  }),
  route('GET', '/api/gateway/subscriptions', ({ res, url }) => {
    const workspaceId = url.searchParams.get('workspaceId') ?? undefined;
    const status = normalizeSubscriptionStatus(url.searchParams.get('status'));
    sendJson(res, {
      subscriptions: getStore().listWorkspaceSubscriptions(workspaceId, status)
    });
  }),
  route('PUT', '/api/gateway/subscriptions/:userId', async ({ req, res, params }) => {
    const body = await readJson<{
      workspaceId?: string;
      displayName?: string;
      status?: unknown;
      channelScopeMode?: unknown;
      channelScope?: unknown;
      timezone?: string;
      workdayStartHour?: number;
      workdayEndHour?: number;
      policyProfileName?: string;
    }>(req);
    const store = getStore();
    const workspace = resolveRequestWorkspace(body.workspaceId);

    if (!workspace) {
      sendJson(res, {
        ok: false,
        error: getSlackService().hasUnreadableInstall() ? 'slack_reconnect_required' : 'workspace_not_installed'
      }, 400);
      return;
    }

    let member: ChannelSetupMember;
    try {
      member = await getChannelRegistry().getMember(workspace, params.userId);
    } catch (error) {
      sendJson(res, {
        ok: false,
        error: 'subscriber_not_found',
        workspace: workspaceDescriptor(workspace),
        ownerUserId: params.userId,
        message: error instanceof Error ? error.message : 'Subscriber user was not found in this workspace'
      }, 400);
      return;
    }

    const existingSubscription = store.getWorkspaceSubscription(workspace.id, params.userId);
    const channelScopeMode =
      normalizeChannelScopeMode(body.channelScopeMode) ?? existingSubscription?.channelScopeMode ?? 'all_accessible';
    const channelScope = channelScopeMode === 'all_accessible'
      ? []
      : channelScopeFromBody(body.channelScope) ?? existingSubscription?.channelScope ?? [];
    if (channelScopeMode === 'selected' && channelScope.length === 0) {
      sendJson(res, {
        ok: false,
        error: 'subscription_channel_scope_required',
        workspace: workspaceDescriptor(workspace),
        ownerUserId: params.userId
      }, 400);
      return;
    }
    const membershipResults: ChannelEnsureMemberResult[] = [];

    if (channelScopeMode === 'selected') {
      for (const channelId of channelScope) {
        membershipResults.push(await getChannelRegistry().ensureMember(workspace, workspace.provider, channelId));
      }
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
      updateConfirmedChannels(workspace, channelScope, membershipResults);
      sendJson(res, {
        ok: false,
        error: 'channels_require_action',
        workspace: workspaceDescriptor(workspace),
        autoJoined,
        requiresInvitation,
        reinstallRequired,
        errors
      }, 409);
      return;
    }

    updateConfirmedChannels(workspace, channelScope, membershipResults);
    const user = store.upsertUser({
      workspaceId: workspace.id,
      externalUserId: params.userId,
      displayName: body.displayName ?? member.displayName ?? params.userId,
      timezone: body.timezone,
      workdayStartHour: body.workdayStartHour,
      workdayEndHour: body.workdayEndHour
    });
    const subscription = store.ensureWorkspaceSubscriptionForUser(user, {
      provider: workspace.provider,
      status: normalizeSubscriptionStatus(body.status) ?? existingSubscription?.status ?? 'active',
      channelScopeMode,
      channelScope,
      policyProfileName: body.policyProfileName ?? existingSubscription?.policyProfileName
    });

    sendJson(res, { ok: true, subscription, autoJoined }, 200);
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
    const workspace = resolveRequestWorkspace(body.workspaceId);

    if (!workspace) {
      sendJson(res, {
        ok: false,
        error: getSlackService().hasUnreadableInstall() ? 'slack_reconnect_required' : 'workspace_not_installed'
      }, 400);
      return;
    }

    const existingSubscription = store.getWorkspaceSubscription(workspace.id, params.userId);
    if (existingSubscription?.status !== 'active') {
      sendJson(res, {
        ok: false,
        error: 'subscription_required',
        workspace: workspaceDescriptor(workspace),
        ownerUserId: params.userId
      }, 403);
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
    if (existingSubscription) {
      store.ensureWorkspaceSubscriptionForUser(user, {
        provider: workspace.provider,
        status: existingSubscription.status,
        channelScopeMode: existingSubscription.channelScopeMode,
        channelScope: existingSubscription.channelScope,
        policyProfileName: existingSubscription.policyProfileName,
        dashboardTokenHash: existingSubscription.dashboardTokenHash
      });
    }
    sendJson(res, { ok: true, user });
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

    const ownerUserId = body.ownerUserId;
    if (!body.channelId || !ownerUserId) {
      sendJson(res, { ok: false, error: 'channel_and_owner_required' }, 400);
      return;
    }

    const ownerCheck = requireMatchingSetupOwner(workspace, ownerUserId);
    if (!ownerCheck.ok) {
      sendJson(res, {
        ok: false,
        error: ownerCheck.error,
        workspace: workspaceDescriptor(workspace),
        ownerUserId,
        owner: ownerCheck.owner
      }, 400);
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
    gateway.reconcileSessionExpirations();
    sendJson(res, {
      sessions: getStore().listActiveSessions(url.searchParams.get('workspaceId') ?? undefined)
    });
  }),
  route('POST', '/api/gateway/sessions', async ({ req, res }) => {
    await ensureRuntimeInitialized();
    const body = await readJson<SessionCreateInput>(req);
    const prepared = await prepareSessionTarget(body);
    if (!prepared.ok) {
      sendJson(res, prepared.payload, prepared.status);
      return;
    }

    let session;
    try {
      session = await createPreparedSession(prepared.target, body);
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'session_create_failed' }, 400);
      return;
    }
    sendJson(res, { ok: true, session, autoJoined: prepared.target.autoJoined }, 201);
  }),
  route('POST', '/api/gateway/sessions/bulk', async ({ req, res }) => {
    await ensureRuntimeInitialized();
    const body = await readJson<Omit<SessionCreateInput, 'workspaceId' | 'channelScope'> & {
      targets?: Array<{ workspaceId?: string; ownerUserId?: string; channelScope?: string[] }>;
    }>(req);
    const targets = Array.isArray(body.targets) ? body.targets : [];
    if (targets.length === 0) {
      sendJson(res, { ok: false, error: 'targets_required' }, 400);
      return;
    }

    const preparedTargets: PreparedSessionTarget[] = [];
    const failures: Record<string, unknown>[] = [];
    for (const target of targets) {
      const ownerUserId = target.ownerUserId ?? (targets.length === 1 ? body.ownerUserId : undefined);
      const prepared = await prepareSessionTarget({
        ...body,
        workspaceId: target.workspaceId,
        ownerUserId,
        channelScope: target.channelScope
      });
      if (prepared.ok) {
        preparedTargets.push(prepared.target);
      } else {
        failures.push(prepared.payload);
      }
    }

    if (failures.length > 0) {
      sendJson(res, {
        ok: false,
        error: failures.some((failure) => failure.error === 'channels_require_action')
          ? 'channels_require_action'
          : 'session_targets_failed',
        targets: failures
      }, failures.some((failure) => failure.error === 'channels_require_action') ? 409 : 400);
      return;
    }

    const sessions = [];
    try {
      for (const target of preparedTargets) {
        sessions.push(await createPreparedSession(target, body));
      }
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'session_create_failed' }, 400);
      return;
    }

    sendJson(res, {
      ok: true,
      sessions,
      autoJoined: preparedTargets.map((target) => ({
        workspace: workspaceDescriptor(target.workspace),
        channels: target.autoJoined
      }))
    }, 201);
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
      gateway.reconcileSessionExpirations();
    }

    sendJson(res, {
      ok: true,
      session,
      briefing: getStore().getMorningBriefing(params.id)
    });
  })
];
