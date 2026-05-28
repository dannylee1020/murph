import { openSlackPersonalHandoff } from '#shared/server/channels/personal-handoff';

const handoffShortcutCallbackId = 'murph_personal_handoff';

interface SlackInteractionResponse {
  response_type: 'ephemeral';
  text: string;
}

interface SlackInteractionResult extends SlackInteractionResponse {
  ok: boolean;
}

export interface SlackSocketInteractionEnvelope {
  ack?: (response?: SlackInteractionResponse) => Promise<void>;
  body?: Record<string, unknown>;
  envelope_id?: string;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function slackUserIdFromMention(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /<@([A-Z0-9]+)(?:\|[^>]+)?>/i.exec(value);
  return match?.[1];
}

export function parseSlackInteractionPayload(rawBody: string): Record<string, unknown> {
  const form = new URLSearchParams(rawBody);
  const payload = form.get('payload');
  if (payload) {
    return JSON.parse(payload) as Record<string, unknown>;
  }

  return {
    type: 'slash_command',
    command: form.get('command') ?? undefined,
    team_id: form.get('team_id') ?? undefined,
    user_id: form.get('user_id') ?? undefined,
    response_url: form.get('response_url') ?? undefined,
    text: form.get('text') ?? ''
  };
}

function slackInteractionUserId(payload: Record<string, unknown>): string | undefined {
  const user = recordValue(payload.user);
  return stringValue(user?.id) ?? stringValue(payload.user_id);
}

function slackInteractionTeamId(payload: Record<string, unknown>): string | undefined {
  const team = recordValue(payload.team);
  return stringValue(team?.id) ?? stringValue(payload.team_id);
}

function slackInteractionSelectedText(payload: Record<string, unknown>): string | undefined {
  const message = recordValue(payload.message);
  return stringValue(message?.text);
}

function slackInteractionOwnerUserId(payload: Record<string, unknown>): string | undefined {
  const text = stringValue(payload.text);
  const mentioned = slackUserIdFromMention(text);
  if (mentioned) return mentioned;

  const message = recordValue(payload.message);
  return stringValue(message?.user);
}

function slackInteractionOwnerHint(payload: Record<string, unknown>): string | undefined {
  const text = stringValue(payload.text);
  return text?.replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/gi, '').trim() || undefined;
}

function slackInteractionResponseUrl(payload: Record<string, unknown>): string | undefined {
  return stringValue(payload.response_url);
}

function isMurphHandoffShortcut(payload: Record<string, unknown>): boolean {
  return payload.callback_id === handoffShortcutCallbackId;
}

async function postSlackInteractionResponse(responseUrl: string | undefined, text: string): Promise<void> {
  if (!responseUrl) return;

  try {
    const response = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', text })
    });
    if (!response.ok) {
      console.warn('[slack] interaction response failed:', response.status, response.statusText);
    }
  } catch (error) {
    console.warn('[slack] interaction response failed:', error instanceof Error ? error.message : error);
  }
}

export async function handleSlackInteractionPayload(payload: Record<string, unknown>): Promise<SlackInteractionResult> {
  const senderUserId = slackInteractionUserId(payload);
  if (!senderUserId) {
    return {
      ok: false,
      response_type: 'ephemeral',
      text: 'Murph could not identify the Slack user.'
    };
  }

  const result = await openSlackPersonalHandoff({
    teamId: slackInteractionTeamId(payload),
    senderUserId,
    ownerUserId: slackInteractionOwnerUserId(payload),
    ownerHint: slackInteractionOwnerHint(payload),
    selectedText: slackInteractionSelectedText(payload)
  });

  return {
    ok: result.ok,
    response_type: 'ephemeral',
    text: result.message
  };
}

export async function handleSlackSocketSlashCommand(envelope: SlackSocketInteractionEnvelope): Promise<void> {
  const payload = envelope.body;
  await envelope.ack?.({
    response_type: 'ephemeral',
    text: 'Opening Murph Personal...'
  });

  if (!payload) return;

  const result = await handleSlackInteractionPayload(payload);
  await postSlackInteractionResponse(slackInteractionResponseUrl(payload), result.text);
}

export async function handleSlackSocketInteractive(envelope: SlackSocketInteractionEnvelope): Promise<void> {
  const payload = envelope.body;
  await envelope.ack?.();

  if (!payload || !isMurphHandoffShortcut(payload)) return;

  const result = await handleSlackInteractionPayload(payload);
  await postSlackInteractionResponse(slackInteractionResponseUrl(payload), result.text);
}

