import { getSlackService } from '#app/server/channels/slack/service';
import { normalizeSlackEvent, type SlackIgnoredReason } from '#app/server/channels/slack/adapter';
import { getGateway } from '#app/server/runtime/gateway';
import { getStore } from '#app/server/persistence/store';
import { markIngressIgnored } from '#app/server/channels/ingress-health';
import { providerBotRoleEnabled } from '#app/server/setup/bot-roles';
import type { BotRole } from '#app/types';

export interface SlackEnvelopeHandleResult {
  ok: boolean;
  ignored?: true;
  reason?: SlackIgnoredReason | 'workspace_not_installed' | 'duplicate_event' | 'bot_role_disabled';
  taskId?: string;
  audit?: unknown;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function eventFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return typeof payload.event === 'object' && payload.event ? (payload.event as Record<string, unknown>) : payload;
}

export function slackLogFields(payload: Record<string, unknown>, event = eventFromPayload(payload)): Record<string, unknown> {
  return {
    eventId: typeof payload.event_id === 'string' ? payload.event_id : undefined,
    teamId: typeof payload.team_id === 'string' ? payload.team_id : undefined,
    type: typeof event?.type === 'string' ? event.type : typeof payload.type === 'string' ? payload.type : undefined,
    channel: typeof event?.channel === 'string' ? event.channel : undefined,
    user: typeof event?.user === 'string' ? event.user : undefined
  };
}

export async function handleSlackEventEnvelope(
  payload: Record<string, unknown>,
  options: {
    rawPayload?: string;
    envelopeId?: string;
    source?: 'http' | 'socket';
    botRole?: BotRole;
    botInstallationId?: string;
  } = {}
): Promise<SlackEnvelopeHandleResult> {
  const event = eventFromPayload(payload);
  const eventId = firstString(payload.event_id, options.envelopeId);
  const teamId = firstString(payload.team_id, payload.authorizations && Array.isArray(payload.authorizations)
    ? (payload.authorizations[0] as { team_id?: unknown } | undefined)?.team_id
    : undefined);
  const botRole = options.botRole ?? 'channel';
  if (!providerBotRoleEnabled(getStore().getAppSettings().setupDefaults, 'slack', botRole)) {
    markIngressIgnored('slack', 'bot_role_disabled');
    console.info('[slack] ignored event', {
      ...slackLogFields(payload, event),
      source: options.source ?? 'http',
      reason: 'bot_role_disabled',
      botRole
    });
    return { ok: false, ignored: true, reason: 'bot_role_disabled' };
  }
  const botInstallationId = options.botInstallationId ??
    (() => {
      if (!teamId) return undefined;
      const installation = getStore().getBotInstallation('slack', teamId, botRole);
      const roleConfig = getStore().getBotAppConfig('slack', botRole);
      const appId = botRole === 'personal'
        ? process.env.SLACK_PERSONAL_APP_ID ?? roleConfig?.appId
        : process.env.SLACK_CHANNEL_APP_ID ?? process.env.SLACK_APP_ID ?? roleConfig?.appId;
      if (!installation || !appId || installation.appId !== appId) return undefined;
      if (botRole === 'personal' && !installation.representedUserId) return undefined;
      return installation.id;
    })();
  const normalized = normalizeSlackEvent(event, { eventId, teamId, botRole, botInstallationId });

  if (!normalized.task) {
    markIngressIgnored('slack', normalized.ignoredReason);
    console.info('[slack] ignored event', {
      ...slackLogFields(payload, event),
      source: options.source ?? 'http',
      reason: normalized.ignoredReason
    });
    return { ok: false, ignored: true, reason: normalized.ignoredReason };
  }

  const routedTask = normalized.task;
  const store = getStore();
  const workspace =
    store.getWorkspaceByExternalId('slack', routedTask.workspaceId) ??
    store.getWorkspaceById(routedTask.workspaceId);

  if (!workspace) {
    markIngressIgnored('slack', 'workspace_not_installed');
    console.info('[slack] ignored event', {
      ...slackLogFields(payload, event),
      source: options.source ?? 'http',
      reason: 'workspace_not_installed'
    });
    return { ok: false, ignored: true, reason: 'workspace_not_installed' };
  }

  const inserted = store.saveSlackEvent({
    workspaceId: workspace.id,
    dedupeKey: routedTask.dedupeKey ?? routedTask.id,
    eventType: routedTask.eventType ?? 'unknown',
    payloadJson: options.rawPayload ?? JSON.stringify(payload)
  });
  store.saveChannelEvent({
    provider: 'slack',
    workspaceId: workspace.id,
    dedupeKey: routedTask.dedupeKey ?? routedTask.id,
    eventType: routedTask.eventType ?? 'unknown',
    payloadJson: options.rawPayload ?? JSON.stringify(payload)
  });

  if (!inserted) {
    markIngressIgnored('slack', 'duplicate_event');
    console.info('[slack] ignored event', {
      ...slackLogFields(payload, event),
      source: options.source ?? 'http',
      reason: 'duplicate_event'
    });
    return { ok: true, ignored: true, reason: 'duplicate_event' };
  }

  const audit = await getGateway().handleTask(routedTask);
  console.info('[slack] handled event', {
    ...slackLogFields(payload, event),
    source: options.source ?? 'http',
    taskId: routedTask.id,
    targetUserId: routedTask.targetUserId,
    disposition: audit.disposition
  });

  return { ok: true, taskId: routedTask.id, audit };
}

export function verifySlackHttpSignature(headers: Headers, rawBody: string, role: BotRole = 'channel'): boolean {
  return getSlackService().verifySignature(headers, rawBody, role);
}
