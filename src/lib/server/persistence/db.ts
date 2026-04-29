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

function ensureSchema(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      slack_team_id TEXT NOT NULL UNIQUE,
      provider TEXT,
      external_workspace_id TEXT,
      name TEXT NOT NULL,
      bot_token_encrypted TEXT,
      bot_user_id TEXT,
      installed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
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
      owner_slack_user_id TEXT NOT NULL,
      owner_user_id TEXT,
      title TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      channel_scope_json TEXT NOT NULL,
      policy_profile_name TEXT,
      policy_override_raw TEXT,
      policy_json TEXT,
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

    CREATE TABLE IF NOT EXISTS user_memory (
      workspace_id TEXT NOT NULL,
      slack_user_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      PRIMARY KEY (workspace_id, slack_user_id)
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

    CREATE TABLE IF NOT EXISTS feedback_memory (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      thread_ts TEXT NOT NULL,
      original_action TEXT NOT NULL,
      final_action TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  ensureColumn(db, 'autopilot_sessions', 'policy_profile_name', 'TEXT');
  ensureColumn(db, 'autopilot_sessions', 'policy_override_raw', 'TEXT');
  ensureColumn(db, 'autopilot_sessions', 'policy_json', 'TEXT');
  ensureColumn(db, 'workspaces', 'provider', 'TEXT');
  ensureColumn(db, 'workspaces', 'external_workspace_id', 'TEXT');
  ensureColumn(db, 'users', 'external_user_id', 'TEXT');
  ensureColumn(db, 'users', 'fallback_external_user_id', 'TEXT');
  ensureColumn(db, 'autopilot_sessions', 'owner_user_id', 'TEXT');

  db.exec(`
    UPDATE workspaces
    SET provider = COALESCE(provider, 'slack'),
        external_workspace_id = COALESCE(external_workspace_id, slack_team_id)
    WHERE provider IS NULL OR external_workspace_id IS NULL;

    UPDATE users
    SET external_user_id = COALESCE(external_user_id, slack_user_id),
        fallback_external_user_id = COALESCE(fallback_external_user_id, fallback_slack_user_id)
    WHERE external_user_id IS NULL OR fallback_external_user_id IS NULL;

    UPDATE autopilot_sessions
    SET owner_user_id = COALESCE(owner_user_id, owner_slack_user_id)
    WHERE owner_user_id IS NULL;

    INSERT OR IGNORE INTO user_memory_v2 (workspace_id, user_id, data_json)
    SELECT workspace_id, slack_user_id, data_json
    FROM user_memory;
  `);
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
