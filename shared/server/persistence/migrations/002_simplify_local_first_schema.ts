import { columnNames, hasAnyColumn, sqlColumn, tableExists } from './helpers.js';
import type { Migration } from './types.js';
import type Database from 'better-sqlite3';

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

function needsCleanup(db: Database.Database): boolean {
  return hasAnyColumn(db, 'workspaces', ['slack_team_id', 'bot_token_encrypted']) ||
    hasAnyColumn(db, 'users', ['slack_user_id', 'fallback_slack_user_id']) ||
    hasAnyColumn(db, 'autopilot_sessions', ['owner_slack_user_id']) ||
    tableExists(db, 'integration_credentials') ||
    tableExists(db, 'user_memory') ||
    tableExists(db, 'feedback_memory');
}

export const simplifyLocalFirstSchema: Migration = {
  id: '002_simplify_local_first_schema',
  description: 'remove sqlite secrets and slack-keyed legacy tables',
  destructive: true,
  shouldBackup: needsCleanup,
  up(db) {
    rebuildWorkspaces(db);
    rebuildUsers(db);
    rebuildSessions(db);
    migrateIntegrationConnections(db);
    dropLegacyTables(db);
  }
};
