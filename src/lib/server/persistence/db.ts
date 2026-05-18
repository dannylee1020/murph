import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getRuntimeEnv } from '#lib/server/util/env';

let database: Database.Database | null = null;

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

function columnNames(db: Database.Database, table: string): Set<string> {
  if (!tableExists(db, table)) {
    return new Set();
  }
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((entry) => entry.name));
}

function sqlColumn(columns: Set<string>, name: string, fallback: string): string {
  return columns.has(name) ? name : fallback;
}

function rebuildWorkspaces(db: Database.Database): void {
  const columns = columnNames(db, 'workspaces');
  if (columns.size === 0 || (!columns.has('slack_team_id') && !columns.has('bot_token_encrypted'))) {
    return;
  }

  const provider = sqlColumn(columns, 'provider', `'slack'`);
  const legacyExternal = columns.has('slack_team_id') ? 'slack_team_id' : 'id';
  const externalWorkspaceId = columns.has('external_workspace_id')
    ? `COALESCE(NULLIF(external_workspace_id, ''), ${legacyExternal})`
    : legacyExternal;
  const botUserId = sqlColumn(columns, 'bot_user_id', 'NULL');
  const installedAt = sqlColumn(columns, 'installed_at', `datetime('now')`);

  db.exec(`
    CREATE TABLE workspaces_new (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      bot_user_id TEXT,
      installed_at TEXT NOT NULL,
      UNIQUE(provider, external_workspace_id)
    );
    INSERT OR IGNORE INTO workspaces_new (id, provider, external_workspace_id, name, bot_user_id, installed_at)
    SELECT id,
           COALESCE(NULLIF(${provider}, ''), 'slack'),
           ${externalWorkspaceId},
           name,
           ${botUserId},
           COALESCE(${installedAt}, datetime('now'))
    FROM workspaces;
    DROP TABLE workspaces;
    ALTER TABLE workspaces_new RENAME TO workspaces;
  `);
}

function rebuildUsers(db: Database.Database): void {
  const columns = columnNames(db, 'users');
  if (columns.size === 0 || (!columns.has('slack_user_id') && !columns.has('fallback_slack_user_id'))) {
    return;
  }

  const externalUserId = columns.has('external_user_id')
    ? `COALESCE(NULLIF(external_user_id, ''), slack_user_id)`
    : 'slack_user_id';
  const fallbackExternalUserId = columns.has('fallback_external_user_id')
    ? columns.has('fallback_slack_user_id')
      ? `COALESCE(NULLIF(fallback_external_user_id, ''), fallback_slack_user_id)`
      : 'fallback_external_user_id'
    : columns.has('fallback_slack_user_id')
      ? 'fallback_slack_user_id'
      : 'NULL';

  db.exec(`
    CREATE TABLE users_new (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      fallback_external_user_id TEXT,
      timezone TEXT NOT NULL,
      workday_start_hour INTEGER NOT NULL,
      workday_end_hour INTEGER NOT NULL,
      UNIQUE(workspace_id, external_user_id)
    );
    INSERT OR IGNORE INTO users_new (
      id, workspace_id, external_user_id, display_name, fallback_external_user_id,
      timezone, workday_start_hour, workday_end_hour
    )
    SELECT id,
           workspace_id,
           ${externalUserId},
           display_name,
           ${fallbackExternalUserId},
           timezone,
           workday_start_hour,
           workday_end_hour
    FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
  `);
}

function rebuildSessions(db: Database.Database): void {
  const columns = columnNames(db, 'autopilot_sessions');
  if (columns.size === 0 || !columns.has('owner_slack_user_id')) {
    return;
  }

  const ownerUserId = columns.has('owner_user_id')
    ? `COALESCE(NULLIF(owner_user_id, ''), owner_slack_user_id)`
    : 'owner_slack_user_id';
  const policyProfileName = sqlColumn(columns, 'policy_profile_name', 'NULL');
  const policyOverrideRaw = sqlColumn(columns, 'policy_override_raw', 'NULL');
  const policyJson = sqlColumn(columns, 'policy_json', 'NULL');
  const sessionContextJson = sqlColumn(columns, 'session_context_json', 'NULL');

  db.exec(`
    CREATE TABLE autopilot_sessions_new (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
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
    INSERT OR IGNORE INTO autopilot_sessions_new (
      id, workspace_id, owner_user_id, title, mode, status, channel_scope_json,
      policy_profile_name, policy_override_raw, policy_json, session_context_json,
      started_at, ends_at, stopped_at
    )
    SELECT id,
           workspace_id,
           ${ownerUserId},
           title,
           mode,
           status,
           channel_scope_json,
           ${policyProfileName},
           ${policyOverrideRaw},
           ${policyJson},
           ${sessionContextJson},
           started_at,
           ends_at,
           stopped_at
    FROM autopilot_sessions;
    DROP TABLE autopilot_sessions;
    ALTER TABLE autopilot_sessions_new RENAME TO autopilot_sessions;
  `);
}

function migrateIntegrationConnections(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS integration_connections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      credential_kind TEXT NOT NULL,
      metadata_json TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, provider)
    );
  `);

  if (tableExists(db, 'integration_credentials')) {
    db.exec(`
      INSERT OR IGNORE INTO integration_connections (
        id, workspace_id, provider, credential_kind, metadata_json, status, error_message, created_at, updated_at
      )
      SELECT id, workspace_id, provider, credential_kind, metadata_json, status, error_message, created_at, updated_at
      FROM integration_credentials;
      DROP TABLE integration_credentials;
    `);
  }
}

function dropLegacyTables(db: Database.Database): void {
  if (tableExists(db, 'user_memory')) {
    db.exec(`
      INSERT OR IGNORE INTO user_memory_v2 (workspace_id, user_id, data_json)
      SELECT workspace_id, slack_user_id, data_json
      FROM user_memory;
      DROP TABLE user_memory;
    `);
  }

  db.exec(`DROP TABLE IF EXISTS feedback_memory;`);
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      bot_user_id TEXT,
      installed_at TEXT NOT NULL,
      UNIQUE(provider, external_workspace_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      fallback_external_user_id TEXT,
      timezone TEXT NOT NULL,
      workday_start_hour INTEGER NOT NULL,
      workday_end_hour INTEGER NOT NULL,
      UNIQUE(workspace_id, external_user_id)
    );

    CREATE TABLE IF NOT EXISTS slack_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS autopilot_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS thread_states (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      last_message_ts TEXT NOT NULL,
      continuity_case TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL,
      next_heartbeat_at TEXT,
      UNIQUE(workspace_id, channel_id, thread_ts)
    );

    CREATE TABLE IF NOT EXISTS continuity_actions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      disposition TEXT NOT NULL,
      message TEXT NOT NULL,
      reason TEXT NOT NULL,
      confidence REAL NOT NULL,
      provider TEXT,
      context_snapshot_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_entries (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      thread_ts TEXT NOT NULL,
      action_type TEXT NOT NULL,
      disposition TEXT NOT NULL,
      policy_reason TEXT NOT NULL,
      model_reason TEXT NOT NULL,
      confidence REAL NOT NULL,
      provider TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      task_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      due_at TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      job_type TEXT NOT NULL,
      local_time TEXT NOT NULL,
      timezone TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      next_run_at TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recurring_jobs_due ON recurring_jobs(status, next_run_at);

    CREATE TABLE IF NOT EXISTS provider_settings (
      workspace_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_memory_v2 (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS workspace_memory (
      workspace_id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thread_memory (
      workspace_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      data_json TEXT NOT NULL,
      PRIMARY KEY (workspace_id, channel_id, thread_ts)
    );

    CREATE TABLE IF NOT EXISTS integration_connections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      credential_kind TEXT NOT NULL,
      metadata_json TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, provider)
    );
  `);

  db.exec('BEGIN');
  try {
    rebuildWorkspaces(db);
    rebuildUsers(db);
    rebuildSessions(db);
    migrateIntegrationConnections(db);
    dropLegacyTables(db);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  ensureColumn(db, 'autopilot_sessions', 'policy_profile_name', 'TEXT');
  ensureColumn(db, 'autopilot_sessions', 'policy_override_raw', 'TEXT');
  ensureColumn(db, 'autopilot_sessions', 'policy_json', 'TEXT');
  ensureColumn(db, 'autopilot_sessions', 'session_context_json', 'TEXT');
  ensureColumn(db, 'users', 'fallback_external_user_id', 'TEXT');
  ensureColumn(db, 'continuity_actions', 'context_snapshot_json', 'TEXT');
}

export function getDb(): Database.Database {
  if (database) {
    return database;
  }

  const { sqlitePath } = getRuntimeEnv();
  mkdirSync(path.dirname(sqlitePath), { recursive: true });
  database = new Database(sqlitePath);
  ensureSchema(database);

  return database;
}
