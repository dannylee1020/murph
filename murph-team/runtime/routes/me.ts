import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from '#shared/server/http';
import { route, type Route } from '#shared/server/router';
import { requireSubscriberDashboard } from '#shared/server/auth/dashboard-access';
import { getStore } from '#shared/server/persistence/store';
import { getGateway } from '#shared/server/runtime/gateway';
import { loadPolicyProfiles, normalizePolicyProfileName } from '#shared/server/policies/loader';
import { normalizePolicyExecutionMode } from '#shared/server/runtime/policy-compiler';
import { resolveSubscriberPolicy } from '#shared/server/runtime/subscriber-policy';
import { refreshRuntimeState } from '#shared/server/runtime/refresh';
import { nextDailyRun, parseLocalTime } from '#shared/server/util/cron';
import type { SessionMode, WorkspaceSubscription } from '#shared/types';

const gateway = getGateway();

function withSubscriber(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (subscription: WorkspaceSubscription) => void | Promise<void>
): void | Promise<void> {
  const subscription = requireSubscriberDashboard(req, res);
  if (!subscription) {
    return;
  }
  return handler(subscription);
}

function subscriptionPayload(subscription: WorkspaceSubscription) {
  return {
    id: subscription.id,
    workspaceId: subscription.workspaceId,
    provider: subscription.provider,
    externalUserId: subscription.externalUserId,
    displayName: subscription.displayName,
    status: subscription.status,
    channelScopeMode: subscription.channelScopeMode,
    channelScope: subscription.channelScope,
    schedule: subscription.schedule,
    policyProfileName: subscription.policyProfileName,
    policyMode: subscription.policyMode
  };
}

function sessionEndsAt(subscription: WorkspaceSubscription, input: { stopLocalTime?: string; timezone?: string; durationHours?: number }): string {
  if (input.durationHours !== undefined) {
    return new Date(Date.now() + Math.max(1, input.durationHours) * 60 * 60 * 1000).toISOString();
  }
  const timezone = input.timezone?.trim() || subscription.schedule?.timezone || 'America/Los_Angeles';
  const stopLocalTime = input.stopLocalTime?.trim() || `${String(subscription.schedule?.workdayEndHour ?? 17).padStart(2, '0')}:00`;
  parseLocalTime(stopLocalTime);
  return nextDailyRun(stopLocalTime, timezone).toISOString();
}

async function policyPayload(subscription: WorkspaceSubscription) {
  const profiles = await loadPolicyProfiles();
  const resolved = await resolveSubscriberPolicy({
    workspaceId: subscription.workspaceId,
    ownerUserId: subscription.externalUserId
  });
  return {
    ok: true,
    profiles,
    subscription: subscriptionPayload(subscription),
    mode: resolved.mode,
    selectedProfileName: resolved.userPolicy.profileName,
    compiled: resolved.userPolicy.compiled
  };
}

export const meRoutes: Route[] = [
  route('GET', '/api/me/bootstrap', ({ req, res }) => withSubscriber(req, res, async (subscription) => {
    const store = getStore();
    const workspace = store.getWorkspaceById(subscription.workspaceId);
    sendJson(res, {
      ok: true,
      subscription: subscriptionPayload(subscription),
      workspace: workspace
        ? {
            id: workspace.id,
            provider: workspace.provider,
            name: workspace.name
          }
        : undefined,
      activeSessionCount: store.listActiveSessions(subscription.workspaceId, subscription.externalUserId).length,
      queuedCount: store.listReviewQueue(subscription.workspaceId, undefined, subscription.externalUserId).length
    });
  })),
  route('GET', '/api/me/subscription', ({ req, res }) => withSubscriber(req, res, (subscription) => {
    sendJson(res, { ok: true, subscription: subscriptionPayload(subscription) });
  })),
  route('PUT', '/api/me/subscription', async ({ req, res }) => withSubscriber(req, res, async (subscription) => {
    const body = await readJson<{
      displayName?: string;
      status?: unknown;
      channelScopeMode?: unknown;
      channelScope?: unknown;
      timezone?: string;
      workdayStartHour?: number;
      workdayEndHour?: number;
    }>(req);
    const channelScopeMode =
      body.channelScopeMode === 'selected' || body.channelScopeMode === 'all_accessible'
        ? body.channelScopeMode
        : subscription.channelScopeMode;
    const channelScope = channelScopeMode === 'all_accessible'
      ? []
      : Array.isArray(body.channelScope)
        ? [...new Set(body.channelScope.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean))]
        : subscription.channelScope;
    if (channelScopeMode === 'selected' && channelScope.length === 0) {
      sendJson(res, { ok: false, error: 'channel_scope_required' }, 400);
      return;
    }
    const next = getStore().upsertWorkspaceSubscription({
      workspaceId: subscription.workspaceId,
      provider: subscription.provider,
      externalUserId: subscription.externalUserId,
      displayName: body.displayName?.trim() || subscription.displayName,
      status: body.status === 'paused' ? 'paused' : body.status === 'active' ? 'active' : subscription.status,
      channelScopeMode,
      channelScope,
      schedule: {
        timezone: body.timezone?.trim() || subscription.schedule?.timezone || 'America/Los_Angeles',
        workdayStartHour: body.workdayStartHour ?? subscription.schedule?.workdayStartHour ?? 9,
        workdayEndHour: body.workdayEndHour ?? subscription.schedule?.workdayEndHour ?? 17
      },
      policyProfileName: subscription.policyProfileName,
      policyMode: subscription.policyMode,
      dashboardTokenHash: subscription.dashboardTokenHash
    });
    sendJson(res, { ok: true, subscription: subscriptionPayload(next) });
  })),
  route('GET', '/api/me/policy', ({ req, res }) => withSubscriber(req, res, async (subscription) => {
    sendJson(res, await policyPayload(subscription));
  })),
  route('PUT', '/api/me/policy', async ({ req, res }) => withSubscriber(req, res, async (subscription) => {
    const body = await readJson<{ profileName?: unknown; mode?: unknown }>(req);
    const hasProfileName = Object.prototype.hasOwnProperty.call(body, 'profileName');
    const hasMode = Object.prototype.hasOwnProperty.call(body, 'mode');
    const profileName = typeof body.profileName === 'string'
      ? normalizePolicyProfileName(body.profileName)
      : undefined;
    const policyMode = body.mode === undefined || body.mode === null || body.mode === ''
      ? undefined
      : normalizePolicyExecutionMode(body.mode);
    if (hasProfileName && !profileName && body.profileName !== null && body.profileName !== '') {
      sendJson(res, { ok: false, error: 'invalid_policy_profile' }, 400);
      return;
    }
    if (profileName) {
      const profiles = await loadPolicyProfiles();
      if (!profiles.some((profile) => profile.name === profileName)) {
        sendJson(res, { ok: false, error: 'unknown_policy_profile' }, 400);
        return;
      }
    }
    if (hasMode && !policyMode && body.mode !== null && body.mode !== '') {
      sendJson(res, { ok: false, error: 'invalid_policy_mode' }, 400);
      return;
    }

    const next = getStore().upsertWorkspaceSubscription({
      workspaceId: subscription.workspaceId,
      provider: subscription.provider,
      externalUserId: subscription.externalUserId,
      displayName: subscription.displayName,
      status: subscription.status,
      channelScopeMode: subscription.channelScopeMode,
      channelScope: subscription.channelScope,
      schedule: subscription.schedule,
      policyProfileName: hasProfileName ? profileName ?? null : subscription.policyProfileName,
      policyMode: hasMode ? policyMode ?? null : subscription.policyMode,
      dashboardTokenHash: subscription.dashboardTokenHash
    });
    await refreshRuntimeState({
      reason: 'subscriber_policy_updated',
      workspaceIds: [subscription.workspaceId],
      deferIfRunActive: true
    });
    sendJson(res, await policyPayload(next));
  })),
  route('GET', '/api/me/sessions', ({ req, res }) => withSubscriber(req, res, (subscription) => {
    const store = getStore();
    sendJson(res, {
      active: store.listActiveSessions(subscription.workspaceId, subscription.externalUserId),
      completed: store.listCompletedSessions(subscription.workspaceId, 20, subscription.externalUserId)
    });
  })),
  route('POST', '/api/me/sessions', async ({ req, res }) => withSubscriber(req, res, async (subscription) => {
    if (subscription.status !== 'active') {
      sendJson(res, { ok: false, error: 'subscription_paused' }, 403);
      return;
    }
    const body = await readJson<{
      title?: string;
      mode?: SessionMode;
      stopLocalTime?: string;
      timezone?: string;
      durationHours?: number;
    }>(req);
    const policy = await resolveSubscriberPolicy({
      workspaceId: subscription.workspaceId,
      ownerUserId: subscription.externalUserId,
      requestedMode: body.mode
    });
    const session = getStore().createSession({
      workspaceId: subscription.workspaceId,
      ownerUserId: subscription.externalUserId,
      title: body.title?.trim() || 'Subscriber coverage',
      mode: policy.mode,
      channelScope: subscription.channelScopeMode === 'all_accessible' ? [] : subscription.channelScope,
      policyProfileName: policy.userPolicy.profileName,
      policyOverrideRaw: policy.userPolicy.overrideRaw,
      policy: policy.userPolicy,
      policyBinding: 'config',
      channelScopeBinding: 'setup_defaults',
      endsAt: sessionEndsAt(subscription, body)
    });
    sendJson(res, { ok: true, session }, 201);
  })),
  route('POST', '/api/me/sessions/:id/stop', ({ req, res, params }) => withSubscriber(req, res, (subscription) => {
    const store = getStore();
    const session = store.getSessionById(params.id);
    if (!session || session.workspaceId !== subscription.workspaceId || session.ownerUserId !== subscription.externalUserId) {
      sendJson(res, { ok: false, error: 'not_found' }, 404);
      return;
    }
    store.stopSession(params.id);
    sendJson(res, { ok: true, session: store.getSessionById(params.id) });
  })),
  route('GET', '/api/me/queue', ({ req, res }) => withSubscriber(req, res, (subscription) => {
    sendJson(res, {
      queue: getStore().listReviewQueue(subscription.workspaceId, undefined, subscription.externalUserId)
    });
  })),
  route('POST', '/api/me/queue/:id', async ({ req, res, params }) => withSubscriber(req, res, async (subscription) => {
    const item = getStore().getReviewItem(params.id);
    if (!item || item.workspaceId !== subscription.workspaceId || item.targetUserId !== subscription.externalUserId) {
      sendJson(res, { ok: false, error: 'not_found' }, 404);
      return;
    }
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
      const updated = await gateway.handleReviewAction(params.id, {
        action: body.action,
        message: body.message,
        reason: body.reason
      });
      sendJson(res, { ok: true, item: updated });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'review_action_failed' }, 400);
    }
  })),
  route('GET', '/api/me/triage', ({ req, res, url }) => withSubscriber(req, res, (subscription) => {
    const store = getStore();
    const requestedSessionId = url.searchParams.get('sessionId') ?? undefined;
    const sessions = store.listCompletedSessions(subscription.workspaceId, 20, subscription.externalUserId);
    const session = requestedSessionId
      ? store.getSessionById(requestedSessionId)
      : sessions[0];
    if (requestedSessionId && (!session || session.workspaceId !== subscription.workspaceId || session.ownerUserId !== subscription.externalUserId)) {
      sendJson(res, { ok: false, error: 'not_found' }, 404);
      return;
    }
    const triageCounts = store.countTriageItemsBySession(subscription.workspaceId, sessions.map((entry) => entry.id));
    sendJson(res, {
      session: session ?? null,
      sessions: sessions.map((entry) => ({ ...entry, triageItemCount: triageCounts.get(entry.id) ?? 0 })),
      items: session ? store.listTriageItems(subscription.workspaceId, session.id, subscription.externalUserId) : []
    });
  })),
  route('GET', '/api/me/runs', ({ req, res, url }) => withSubscriber(req, res, (subscription) => {
    sendJson(res, {
      runs: getStore().listAgentRuns(
        url.searchParams.get('sessionId') ?? undefined,
        Number(url.searchParams.get('limit') ?? 50),
        subscription.workspaceId,
        subscription.externalUserId
      )
    });
  })),
  route('GET', '/api/me/runs/:id/events', ({ req, res, params }) => withSubscriber(req, res, (subscription) => {
    const store = getStore();
    const run = store.getAgentRun(params.id);
    if (!run || run.workspaceId !== subscription.workspaceId || run.targetUserId !== subscription.externalUserId) {
      sendJson(res, { ok: false, error: 'not_found' }, 404);
      return;
    }
    sendJson(res, { events: store.listAgentRunEvents(params.id) });
  }))
];
