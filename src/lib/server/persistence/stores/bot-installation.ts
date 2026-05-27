import { randomUUID } from 'node:crypto';
import type { BotInstallation, BotRole, ChannelProvider } from '#lib/types';
import type { Db } from './_shared.js';

export interface BotInstallationInput {
  workspaceId: string;
  provider: ChannelProvider;
  role: BotRole;
  externalWorkspaceId: string;
  botUserId?: string;
  appId?: string;
  representedUserId?: string;
  status?: 'active' | 'paused';
}

interface BotInstallationRow {
  id: string;
  workspace_id: string;
  provider: ChannelProvider;
  role: BotRole;
  external_workspace_id: string;
  bot_user_id?: string;
  app_id?: string;
  represented_user_id?: string;
  status: 'active' | 'paused';
  installed_at: string;
  updated_at: string;
}

function mapBotInstallation(row: BotInstallationRow): BotInstallation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    role: row.role,
    externalWorkspaceId: row.external_workspace_id,
    botUserId: row.bot_user_id ?? undefined,
    appId: row.app_id ?? undefined,
    representedUserId: row.represented_user_id ?? undefined,
    status: row.status,
    installedAt: row.installed_at,
    updatedAt: row.updated_at
  };
}

export function upsertBotInstallation(db: Db, input: BotInstallationInput): BotInstallation {
  const now = new Date().toISOString();
  const existing = getBotInstallation(db, input.provider, input.externalWorkspaceId, input.role);
  const id = existing?.id ?? randomUUID();

  db.prepare(
    `INSERT INTO bot_installations (
      id, workspace_id, provider, role, external_workspace_id, bot_user_id,
      app_id, represented_user_id, status, installed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, external_workspace_id, role) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      bot_user_id = excluded.bot_user_id,
      app_id = COALESCE(excluded.app_id, bot_installations.app_id),
      represented_user_id = excluded.represented_user_id,
      status = excluded.status,
      updated_at = excluded.updated_at`
  ).run(
    id,
    input.workspaceId,
    input.provider,
    input.role,
    input.externalWorkspaceId,
    input.botUserId ?? null,
    input.appId ?? null,
    input.representedUserId ?? null,
    input.status ?? 'active',
    existing?.installedAt ?? now,
    now
  );

  return getBotInstallation(db, input.provider, input.externalWorkspaceId, input.role)!;
}

export function getBotInstallation(
  db: Db,
  provider: ChannelProvider,
  externalWorkspaceId: string,
  role: BotRole
): BotInstallation | undefined {
  const row = db
    .prepare(`SELECT * FROM bot_installations WHERE provider = ? AND external_workspace_id = ? AND role = ?`)
    .get(provider, externalWorkspaceId, role) as BotInstallationRow | undefined;
  return row ? mapBotInstallation(row) : undefined;
}

export function getBotInstallationById(db: Db, id: string): BotInstallation | undefined {
  const row = db.prepare(`SELECT * FROM bot_installations WHERE id = ?`).get(id) as BotInstallationRow | undefined;
  return row ? mapBotInstallation(row) : undefined;
}

export function listBotInstallations(db: Db, input: { provider?: ChannelProvider; role?: BotRole; workspaceId?: string } = {}): BotInstallation[] {
  const filters: string[] = [];
  const values: string[] = [];
  if (input.provider) {
    filters.push('provider = ?');
    values.push(input.provider);
  }
  if (input.role) {
    filters.push('role = ?');
    values.push(input.role);
  }
  if (input.workspaceId) {
    filters.push('workspace_id = ?');
    values.push(input.workspaceId);
  }
  const rows = db
    .prepare(`SELECT * FROM bot_installations${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} ORDER BY installed_at ASC`)
    .all(...values) as BotInstallationRow[];
  return rows.map(mapBotInstallation);
}
