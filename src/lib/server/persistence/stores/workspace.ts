import { randomUUID } from 'node:crypto';
import type { BotRole, Workspace } from '#lib/types';
import type { Db } from './_shared.js';

export interface InstallInput {
  provider?: string;
  externalWorkspaceId?: string;
  name: string;
  botUserId?: string;
  role?: BotRole;
  appId?: string;
  representedUserId?: string;
}

export interface SlackEventInput {
  workspaceId: string;
  dedupeKey: string;
  eventType: string;
  payloadJson: string;
}

export interface ChannelEventInput extends SlackEventInput {
  provider: string;
}

interface WorkspaceRow {
  id: string;
  provider: string;
  external_workspace_id?: string;
  name: string;
  bot_user_id?: string;
  installed_at?: string;
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    provider: row.provider,
    externalWorkspaceId: row.external_workspace_id ?? row.id,
    name: row.name,
    botUserId: row.bot_user_id,
    installedAt: row.installed_at
  };
}

export function saveInstall(db: Db, input: InstallInput): Workspace {
  const provider = input.provider ?? 'slack';
  const externalWorkspaceId = input.externalWorkspaceId;
  if (!externalWorkspaceId) {
    throw new Error('externalWorkspaceId is required');
  }
  const id = randomUUID();
  const existing = getWorkspaceByExternalId(db, provider, externalWorkspaceId);

  if (existing) {
    db.prepare(
      `UPDATE workspaces
       SET provider = ?, external_workspace_id = ?, name = ?, bot_user_id = ?, installed_at = ?
       WHERE id = ?`
    ).run(
      provider,
      externalWorkspaceId,
      input.name,
      input.botUserId ?? null,
      new Date().toISOString(),
      existing.id
    );

    return getWorkspaceById(db, existing.id)!;
  }

  db.prepare(
    `INSERT INTO workspaces (id, provider, external_workspace_id, name, bot_user_id, installed_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    provider,
    externalWorkspaceId,
    input.name,
    input.botUserId ?? null,
    new Date().toISOString()
  );

  return getWorkspaceById(db, id)!;
}

export function getWorkspaceByExternalId(
  db: Db,
  provider: string,
  externalWorkspaceId: string
): Workspace | undefined {
  const row = db
    .prepare(
      `SELECT id, provider, external_workspace_id, name, bot_user_id, installed_at
       FROM workspaces WHERE provider = ? AND external_workspace_id = ?`
    )
    .get(provider, externalWorkspaceId) as WorkspaceRow | undefined;
  return row ? mapWorkspace(row) : undefined;
}

export function getWorkspaceById(db: Db, id: string): Workspace | undefined {
  const row = db
    .prepare(
      `SELECT id, provider, external_workspace_id, name, bot_user_id, installed_at
       FROM workspaces WHERE id = ?`
    )
    .get(id) as WorkspaceRow | undefined;
  return row ? mapWorkspace(row) : undefined;
}

export function getFirstWorkspace(db: Db): Workspace | undefined {
  const row = db
    .prepare(
      `SELECT id, provider, external_workspace_id, name, bot_user_id, installed_at
       FROM workspaces ORDER BY installed_at DESC LIMIT 1`
    )
    .get() as WorkspaceRow | undefined;
  return row ? mapWorkspace(row) : undefined;
}

export function listWorkspaces(db: Db): Workspace[] {
  const rows = db
    .prepare(
      `SELECT id, provider, external_workspace_id, name, bot_user_id, installed_at
       FROM workspaces ORDER BY installed_at ASC`
    )
    .all() as WorkspaceRow[];
  return rows.map(mapWorkspace);
}

export function saveSlackEvent(db: Db, input: SlackEventInput): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO slack_events (id, workspace_id, dedupe_key, event_type, payload_json, received_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      input.workspaceId,
      input.dedupeKey,
      input.eventType,
      input.payloadJson,
      new Date().toISOString()
    );

  return result.changes > 0;
}

export function saveChannelEvent(db: Db, input: ChannelEventInput): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO channel_events (id, provider, workspace_id, dedupe_key, event_type, payload_json, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      input.provider,
      input.workspaceId,
      input.dedupeKey,
      input.eventType,
      input.payloadJson,
      new Date().toISOString()
    );

  return result.changes > 0;
}
