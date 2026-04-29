import { randomUUID } from 'node:crypto';
import type { Workspace } from '#lib/types';
import type { Db } from './_shared.js';

export interface InstallInput {
  provider?: string;
  externalWorkspaceId?: string;
  slackTeamId?: string;
  name: string;
  botTokenEncrypted: string;
  botUserId?: string;
}

export interface SlackEventInput {
  workspaceId: string;
  dedupeKey: string;
  eventType: string;
  payloadJson: string;
}

interface WorkspaceRow {
  id: string;
  slack_team_id: string;
  provider?: string;
  external_workspace_id?: string;
  name: string;
  bot_token_encrypted?: string;
  bot_user_id?: string;
  installed_at?: string;
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    provider: row.provider ?? 'slack',
    externalWorkspaceId: row.external_workspace_id ?? row.slack_team_id,
    name: row.name,
    botTokenEncrypted: row.bot_token_encrypted,
    botUserId: row.bot_user_id,
    installedAt: row.installed_at
  };
}

export function saveInstall(db: Db, input: InstallInput): Workspace {
  const provider = input.provider ?? 'slack';
  const externalWorkspaceId = input.externalWorkspaceId ?? input.slackTeamId;
  if (!externalWorkspaceId) {
    throw new Error('externalWorkspaceId is required');
  }
  const id = randomUUID();
  const existing = getWorkspaceByExternalId(db, provider, externalWorkspaceId);

  if (existing) {
    db.prepare(
      `UPDATE workspaces
       SET provider = ?, external_workspace_id = ?, name = ?, bot_token_encrypted = ?, bot_user_id = ?, installed_at = ?
       WHERE id = ?`
    ).run(
      provider,
      externalWorkspaceId,
      input.name,
      input.botTokenEncrypted,
      input.botUserId ?? null,
      new Date().toISOString(),
      existing.id
    );

    return getWorkspaceById(db, existing.id)!;
  }

  db.prepare(
    `INSERT INTO workspaces (id, slack_team_id, provider, external_workspace_id, name, bot_token_encrypted, bot_user_id, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    provider === 'slack' ? externalWorkspaceId : `legacy:${provider}:${externalWorkspaceId}`,
    provider,
    externalWorkspaceId,
    input.name,
    input.botTokenEncrypted,
    input.botUserId ?? null,
    new Date().toISOString()
  );

  return getWorkspaceById(db, id)!;
}

export function getWorkspaceByTeamId(db: Db, slackTeamId: string): Workspace | undefined {
  const row = db
    .prepare(
      `SELECT id, slack_team_id, provider, external_workspace_id, name, bot_token_encrypted, bot_user_id, installed_at
       FROM workspaces WHERE slack_team_id = ?`
    )
    .get(slackTeamId) as WorkspaceRow | undefined;
  return row ? mapWorkspace(row) : undefined;
}

export function getWorkspaceByExternalId(
  db: Db,
  provider: string,
  externalWorkspaceId: string
): Workspace | undefined {
  const row = db
    .prepare(
      `SELECT id, slack_team_id, provider, external_workspace_id, name, bot_token_encrypted, bot_user_id, installed_at
       FROM workspaces WHERE provider = ? AND external_workspace_id = ?`
    )
    .get(provider, externalWorkspaceId) as WorkspaceRow | undefined;
  return row ? mapWorkspace(row) : undefined;
}

export function getWorkspaceById(db: Db, id: string): Workspace | undefined {
  const row = db
    .prepare(
      `SELECT id, slack_team_id, provider, external_workspace_id, name, bot_token_encrypted, bot_user_id, installed_at
       FROM workspaces WHERE id = ?`
    )
    .get(id) as WorkspaceRow | undefined;
  return row ? mapWorkspace(row) : undefined;
}

export function getFirstWorkspace(db: Db): Workspace | undefined {
  const row = db
    .prepare(
      `SELECT id, slack_team_id, provider, external_workspace_id, name, bot_token_encrypted, bot_user_id, installed_at
       FROM workspaces ORDER BY installed_at DESC LIMIT 1`
    )
    .get() as WorkspaceRow | undefined;
  return row ? mapWorkspace(row) : undefined;
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
