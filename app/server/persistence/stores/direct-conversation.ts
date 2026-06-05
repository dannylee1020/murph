import { randomUUID } from 'node:crypto';
import type { ChannelProvider, DirectConversation } from '#app/types';
import type { Db } from './common.js';

export interface DirectConversationInput {
  provider: ChannelProvider;
  botInstallationId?: string;
  workspaceId?: string;
  externalUserId: string;
  channelId: string;
  lastSelectedWorkspaceId?: string;
  lastSeenAt?: string;
}

interface DirectConversationRow {
  id: string;
  provider: ChannelProvider;
  bot_installation_id?: string;
  workspace_id?: string;
  external_user_id: string;
  channel_id: string;
  last_selected_workspace_id?: string;
  last_seen_at: string;
}

function mapDirectConversation(row: DirectConversationRow): DirectConversation {
  return {
    id: row.id,
    provider: row.provider,
    botInstallationId: row.bot_installation_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    externalUserId: row.external_user_id,
    channelId: row.channel_id,
    lastSelectedWorkspaceId: row.last_selected_workspace_id ?? undefined,
    lastSeenAt: row.last_seen_at
  };
}

export function upsertDirectConversation(db: Db, input: DirectConversationInput): DirectConversation {
  if (!input.externalUserId) {
    throw new Error('externalUserId is required');
  }
  if (!input.channelId) {
    throw new Error('channelId is required');
  }

  const existing = getDirectConversationByChannel(db, input.provider, input.channelId);
  const now = input.lastSeenAt ?? new Date().toISOString();
  const id = existing?.id ?? randomUUID();

  db.prepare(
    `INSERT INTO direct_conversations (
      id, provider, bot_installation_id, workspace_id, external_user_id, channel_id,
      last_selected_workspace_id, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, channel_id) DO UPDATE SET
      bot_installation_id = excluded.bot_installation_id,
      workspace_id = excluded.workspace_id,
      external_user_id = excluded.external_user_id,
      last_selected_workspace_id = excluded.last_selected_workspace_id,
      last_seen_at = excluded.last_seen_at`
  ).run(
    id,
    input.provider,
    input.botInstallationId ?? null,
    input.workspaceId ?? null,
    input.externalUserId,
    input.channelId,
    input.lastSelectedWorkspaceId ?? input.workspaceId ?? null,
    now
  );

  return getDirectConversationByChannel(db, input.provider, input.channelId)!;
}

export function getDirectConversationByChannel(
  db: Db,
  provider: ChannelProvider,
  channelId: string
): DirectConversation | undefined {
  const row = db
    .prepare(`SELECT * FROM direct_conversations WHERE provider = ? AND channel_id = ?`)
    .get(provider, channelId) as DirectConversationRow | undefined;
  return row ? mapDirectConversation(row) : undefined;
}
