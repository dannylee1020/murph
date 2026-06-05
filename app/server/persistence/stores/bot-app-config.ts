import { randomUUID } from 'node:crypto';
import type { BotAppConfig, BotRole, ChannelProvider } from '#app/types';
import type { Db } from './common.js';
import { parseJsonObject } from './common.js';

export interface BotAppConfigInput {
  provider: ChannelProvider;
  role: BotRole;
  appId?: string;
  clientId?: string;
  publicKey?: string;
  eventsMode?: 'http' | 'socket';
  redirectUri?: string;
  metadata?: Record<string, unknown>;
}

interface BotAppConfigRow {
  id: string;
  provider: ChannelProvider;
  role: BotRole;
  app_id?: string;
  client_id?: string;
  public_key?: string;
  events_mode?: string;
  redirect_uri?: string;
  metadata_json?: string;
  created_at: string;
  updated_at: string;
}

function stringValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeEventsMode(value: string | undefined): 'http' | 'socket' | undefined {
  if (value === 'http') return 'http';
  if (value === 'socket') return 'socket';
  return undefined;
}

function mapBotAppConfig(row: BotAppConfigRow): BotAppConfig {
  return {
    id: row.id,
    provider: row.provider,
    role: row.role,
    appId: row.app_id ?? undefined,
    clientId: row.client_id ?? undefined,
    publicKey: row.public_key ?? undefined,
    eventsMode: normalizeEventsMode(row.events_mode),
    redirectUri: row.redirect_uri ?? undefined,
    metadata: parseJsonObject<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function upsertBotAppConfig(db: Db, input: BotAppConfigInput): BotAppConfig {
  const now = new Date().toISOString();
  const existing = getBotAppConfig(db, input.provider, input.role);
  const id = existing?.id ?? randomUUID();
  const eventsMode = input.eventsMode === 'http' ? 'http' : input.eventsMode === 'socket' ? 'socket' : undefined;

  db.prepare(
    `INSERT INTO bot_app_configs (
      id, provider, role, app_id, client_id, public_key, events_mode,
      redirect_uri, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, role) DO UPDATE SET
      app_id = COALESCE(excluded.app_id, bot_app_configs.app_id),
      client_id = COALESCE(excluded.client_id, bot_app_configs.client_id),
      public_key = COALESCE(excluded.public_key, bot_app_configs.public_key),
      events_mode = COALESCE(excluded.events_mode, bot_app_configs.events_mode),
      redirect_uri = COALESCE(excluded.redirect_uri, bot_app_configs.redirect_uri),
      metadata_json = COALESCE(excluded.metadata_json, bot_app_configs.metadata_json),
      updated_at = excluded.updated_at`
  ).run(
    id,
    input.provider,
    input.role,
    stringValue(input.appId) ?? null,
    stringValue(input.clientId) ?? null,
    stringValue(input.publicKey) ?? null,
    eventsMode ?? null,
    stringValue(input.redirectUri) ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    existing?.createdAt ?? now,
    now
  );

  return getBotAppConfig(db, input.provider, input.role)!;
}

export function getBotAppConfig(
  db: Db,
  provider: ChannelProvider,
  role: BotRole
): BotAppConfig | undefined {
  const row = db
    .prepare(`SELECT * FROM bot_app_configs WHERE provider = ? AND role = ?`)
    .get(provider, role) as BotAppConfigRow | undefined;
  return row ? mapBotAppConfig(row) : undefined;
}

export function listBotAppConfigs(db: Db): BotAppConfig[] {
  const rows = db
    .prepare(`SELECT * FROM bot_app_configs ORDER BY provider ASC, role ASC`)
    .all() as BotAppConfigRow[];
  return rows.map(mapBotAppConfig);
}
