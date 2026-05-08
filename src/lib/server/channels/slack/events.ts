import { getSlackService } from '#lib/server/channels/slack/service';
import { normalizeSlackEvent, type SlackIgnoredReason } from '#lib/server/channels/slack/adapter';
import { getGateway } from '#lib/server/runtime/gateway';
import { getStore } from '#lib/server/persistence/store';

export interface SlackEnvelopeHandleResult {
  ok: boolean;
  ignored?: true;
  reason?: SlackIgnoredReason | 'workspace_not_installed' | 'duplicate_event';
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
  } = {}
): Promise<SlackEnvelopeHandleResult> {
  const event = eventFromPayload(payload);
  const eventId = firstString(payload.event_id, options.envelopeId);
  const teamId = firstString(payload.team_id, payload.authorizations && Array.isArray(payload.authorizations)
    ? (payload.authorizations[0] as { team_id?: unknown } | undefined)?.team_id
    : undefined);
  const normalized = normalizeSlackEvent(event, { eventId, teamId });

  if (!normalized.task) {
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
    store.getWorkspaceByTeamId(routedTask.workspaceId);

  if (!workspace) {
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

  if (!inserted) {
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

export function verifySlackHttpSignature(headers: Headers, rawBody: string): boolean {
  return getSlackService().verifySignature(headers, rawBody);
}
