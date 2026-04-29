import { DEFAULT_PROVIDER_MODEL } from '#lib/config';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getGateway } from '#lib/server/runtime/gateway';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import { normalizeSlackEvent } from '#lib/server/channels/slack/adapter';
import { getSlackService } from '#lib/server/channels/slack/service';
import { getStore } from '#lib/server/persistence/store';
import { readBody, redirect, sendJson, toHeaders } from '../http.js';
import { route, type Route } from '../router.js';

const gateway = getGateway();

function slackLogFields(payload: Record<string, unknown>, event?: Record<string, unknown>): Record<string, unknown> {
  return {
    eventId: typeof payload.event_id === 'string' ? payload.event_id : undefined,
    teamId: typeof payload.team_id === 'string' ? payload.team_id : undefined,
    type: typeof event?.type === 'string' ? event.type : typeof payload.type === 'string' ? payload.type : undefined,
    channel: typeof event?.channel === 'string' ? event.channel : undefined,
    user: typeof event?.user === 'string' ? event.user : undefined
  };
}

export const slackRoutes: Route[] = [
  route('POST', '/api/slack/events', async ({ req, res }) => {
    await ensureRuntimeInitialized();
    const rawBody = await readBody(req);
    const slack = getSlackService();

    if (!slack.verifySignature(toHeaders(req), rawBody)) {
      console.warn('[slack] rejected event: invalid_signature');
      sendJson(res, { ok: false, error: 'invalid_signature' }, 401);
      return;
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;

    if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
      sendJson(res, { challenge: payload.challenge });
      return;
    }

    const event =
      typeof payload.event === 'object' && payload.event ? (payload.event as Record<string, unknown>) : payload;
    const normalized = normalizeSlackEvent(event, {
      eventId: typeof payload.event_id === 'string' ? payload.event_id : undefined,
      teamId: typeof payload.team_id === 'string' ? payload.team_id : undefined
    });

    if (!normalized.task) {
      console.info('[slack] ignored event', {
        ...slackLogFields(payload, event),
        reason: normalized.ignoredReason
      });
      sendJson(res, { ok: false, ignored: true, reason: normalized.ignoredReason });
      return;
    }

    const routedTask = normalized.task;
    const store = getStore();
    const workspace =
      store.getWorkspaceByExternalId('slack', routedTask.workspaceId) ??
      store.getWorkspaceByTeamId(routedTask.workspaceId);

    if (!workspace) {
      console.info('[slack] ignored event', {
        ...slackLogFields(payload, event),
        reason: 'workspace_not_installed'
      });
      sendJson(res, { ok: false, ignored: true, reason: 'Workspace is not installed.' });
      return;
    }

    const inserted = store.saveSlackEvent({
      workspaceId: workspace.id,
      dedupeKey: routedTask.dedupeKey ?? routedTask.id,
      eventType: routedTask.eventType ?? 'unknown',
      payloadJson: rawBody
    });

    if (!inserted) {
      console.info('[slack] ignored event', {
        ...slackLogFields(payload, event),
        reason: 'duplicate_event'
      });
      sendJson(res, { ok: true, ignored: true, reason: 'Duplicate Slack event.' });
      return;
    }

    const audit = await gateway.handleTask(routedTask);
    console.info('[slack] handled event', {
      ...slackLogFields(payload, event),
      taskId: routedTask.id,
      targetUserId: routedTask.targetUserId,
      disposition: audit.disposition
    });
    sendJson(res, { ok: true, taskId: routedTask.id, audit });
  }),
  route('GET', '/api/slack/install', ({ res }) => {
    const url = getSlackService().buildInstallUrl();
    redirect(res, url ?? '/settings?error=slack_not_configured');
  }),
  route('GET', '/api/slack/oauth/callback', async ({ res, url }) => {
    const code = url.searchParams.get('code');

    if (!code) {
      redirect(res, '/settings?error=missing_code');
      return;
    }

    const workspace = await getSlackService().exchangeCode(code);
    const env = getRuntimeEnv();

    getStore().upsertProviderSettings({
      workspaceId: workspace.id,
      provider: env.defaultProvider,
      model: DEFAULT_PROVIDER_MODEL[env.defaultProvider]
    });

    redirect(res, '/settings?installed=1');
  })
];
