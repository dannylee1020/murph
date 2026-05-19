import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
  );
}

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (entry) => entry.name
  );
}

function migrationIds(db: Database.Database): string[] {
  return (db.prepare(`SELECT id FROM schema_migrations ORDER BY id`).all() as Array<{ id: string }>)
    .map((row) => row.id);
}

describe('sqlite schema cleanup', () => {
  it('creates the current schema and records migrations for a fresh database', async () => {
    vi.resetModules();
    const sqlitePath = join(mkdtempSync(join(tmpdir(), 'murph-schema-fresh-')), 'murph.sqlite');
    process.env.MURPH_SQLITE_PATH = sqlitePath;

    const { getDb } = await import('#lib/server/persistence/db');
    const db = getDb();

    expect(tableExists(db, 'workspaces')).toBe(true);
    expect(tableExists(db, 'integration_connections')).toBe(true);
    expect(tableExists(db, 'schema_migrations')).toBe(true);
    expect(migrationIds(db)).toEqual([
      '001_create_current_schema',
      '002_simplify_local_first_schema'
    ]);
    const { runMigrations } = await import('#lib/server/persistence/migrator');
    runMigrations(db, sqlitePath);
    expect(migrationIds(db)).toEqual([
      '001_create_current_schema',
      '002_simplify_local_first_schema'
    ]);
    expect(existsSync(`${sqlitePath}.before-002_simplify_local_first_schema.bak`)).toBe(false);
  });

  it('migrates legacy secret and slack-keyed tables to the cleaned schema', async () => {
    vi.resetModules();
    const sqlitePath = join(mkdtempSync(join(tmpdir(), 'murph-schema-')), 'murph.sqlite');
    process.env.MURPH_SQLITE_PATH = sqlitePath;

    const db = new Database(sqlitePath);
    db.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        slack_team_id TEXT NOT NULL UNIQUE,
        provider TEXT,
        external_workspace_id TEXT,
        name TEXT NOT NULL,
        bot_token_encrypted TEXT,
        bot_user_id TEXT,
        installed_at TEXT NOT NULL
      );
      INSERT INTO workspaces
        (id, slack_team_id, provider, external_workspace_id, name, bot_token_encrypted, bot_user_id, installed_at)
      VALUES
        ('workspace-1', 'T1', NULL, NULL, 'Legacy Slack', 'encrypted-token', 'UBOT', '2026-05-01T00:00:00.000Z');

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        slack_user_id TEXT NOT NULL,
        external_user_id TEXT,
        display_name TEXT NOT NULL,
        fallback_slack_user_id TEXT,
        fallback_external_user_id TEXT,
        timezone TEXT NOT NULL,
        workday_start_hour INTEGER NOT NULL,
        workday_end_hour INTEGER NOT NULL,
        UNIQUE(workspace_id, slack_user_id)
      );
      INSERT INTO users
        (id, workspace_id, slack_user_id, external_user_id, display_name, fallback_slack_user_id, fallback_external_user_id, timezone, workday_start_hour, workday_end_hour)
      VALUES
        ('user-1', 'workspace-1', 'U1', NULL, 'Daniel', 'U2', NULL, 'America/Los_Angeles', 9, 17);

      CREATE TABLE autopilot_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        owner_slack_user_id TEXT NOT NULL,
        owner_user_id TEXT,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        channel_scope_json TEXT NOT NULL,
        policy_profile_name TEXT,
        policy_override_raw TEXT,
        policy_json TEXT,
        session_context_json TEXT,
        started_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        stopped_at TEXT
      );
      INSERT INTO autopilot_sessions
        (id, workspace_id, owner_slack_user_id, owner_user_id, title, mode, status, channel_scope_json, started_at, ends_at)
      VALUES
        ('session-1', 'workspace-1', 'U1', NULL, 'Legacy session', 'manual_review', 'active', '[]', '2026-05-01T00:00:00.000Z', '2026-05-02T00:00:00.000Z');

      CREATE TABLE user_memory (
        workspace_id TEXT NOT NULL,
        slack_user_id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY (workspace_id, slack_user_id)
      );
      INSERT INTO user_memory VALUES ('workspace-1', 'U1', '{"userId":"U1","preferences":["brief"],"forbiddenTopics":[],"routingHints":[]}');

      CREATE TABLE feedback_memory (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        session_id TEXT,
        thread_ts TEXT NOT NULL,
        original_action TEXT NOT NULL,
        final_action TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE integration_credentials (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        credential_kind TEXT NOT NULL,
        credential_encrypted TEXT NOT NULL,
        metadata_json TEXT,
        status TEXT NOT NULL DEFAULT 'connected',
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, provider)
      );
      INSERT INTO integration_credentials
        (id, workspace_id, provider, credential_kind, credential_encrypted, metadata_json, status, created_at, updated_at)
      VALUES
        ('integration-1', 'workspace-1', 'github', 'api_key', 'encrypted-secret', '{"account":"octo"}', 'connected', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z');
    `);
    (db as unknown as { close?: () => void }).close?.();

    const { getStore } = await import('#lib/server/persistence/store');
    const store = getStore();
    const workspace = store.getWorkspaceByExternalId('slack', 'T1');

    expect(workspace).toEqual(expect.objectContaining({
      id: 'workspace-1',
      externalWorkspaceId: 'T1',
      name: 'Legacy Slack'
    }));
    expect(store.getUser('workspace-1', 'U1')).toEqual(expect.objectContaining({
      externalUserId: 'U1',
      fallbackExternalUserId: 'U2'
    }));
    expect(store.getSessionById('session-1')).toEqual(expect.objectContaining({
      ownerUserId: 'U1'
    }));
    expect(store.getOrCreateUserMemory('workspace-1', 'U1').preferences).toEqual(['brief']);
    expect(store.getIntegrationConnection('workspace-1', 'github')).toEqual(expect.objectContaining({
      provider: 'github',
      credentialKind: 'api_key',
      metadata: { account: 'octo' },
      status: 'connected'
    }));

    const migrated = new Database(sqlitePath);
    expect(columns(migrated, 'workspaces')).not.toEqual(expect.arrayContaining(['slack_team_id', 'bot_token_encrypted']));
    expect(columns(migrated, 'users')).not.toEqual(expect.arrayContaining(['slack_user_id', 'fallback_slack_user_id']));
    expect(columns(migrated, 'autopilot_sessions')).not.toContain('owner_slack_user_id');
    expect(columns(migrated, 'integration_connections')).not.toContain('credential_encrypted');
    expect(tableExists(migrated, 'integration_credentials')).toBe(false);
    expect(tableExists(migrated, 'user_memory')).toBe(false);
    expect(tableExists(migrated, 'feedback_memory')).toBe(false);
    expect(migrationIds(migrated)).toEqual([
      '001_create_current_schema',
      '002_simplify_local_first_schema'
    ]);
    expect(existsSync(`${sqlitePath}.before-002_simplify_local_first_schema.bak`)).toBe(true);
    (migrated as unknown as { close?: () => void }).close?.();
  });

  it('rolls back failed migrations without recording them', async () => {
    const sqlitePath = join(mkdtempSync(join(tmpdir(), 'murph-schema-failure-')), 'murph.sqlite');
    const db = new Database(sqlitePath);
    const { runMigrationList } = await import('#lib/server/persistence/migrator');

    expect(() => runMigrationList(db, sqlitePath, [
      {
        id: '999_failure',
        description: 'test rollback behavior',
        up(database) {
          database.exec(`CREATE TABLE rolled_back (id TEXT PRIMARY KEY);`);
          throw new Error('intentional migration failure');
        }
      }
    ])).toThrow('intentional migration failure');

    expect(tableExists(db, 'rolled_back')).toBe(false);
    expect(migrationIds(db)).toEqual([]);
    (db as unknown as { close?: () => void }).close?.();
  });
});
