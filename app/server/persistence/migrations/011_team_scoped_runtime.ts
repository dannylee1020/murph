import type Database from 'better-sqlite3';
import { columnNames, sqlColumn, tableExists } from './helpers.js';
import type { Migration } from './types.js';

function rebuildAutopilotSessions(db: Database.Database): void {
  if (!tableExists(db, 'autopilot_sessions')) return;
  const columns = columnNames(db, 'autopilot_sessions');
  db.exec(`
    CREATE TABLE autopilot_sessions_new (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      owner_user_id TEXT,
      title TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      channel_scope_json TEXT NOT NULL,
      policy_profile_name TEXT,
      policy_override_raw TEXT,
      policy_json TEXT,
      session_context_json TEXT,
      runtime_revision_json TEXT,
      last_runtime_refresh_at TEXT,
      policy_binding TEXT NOT NULL DEFAULT 'config',
      channel_scope_binding TEXT NOT NULL DEFAULT 'setup_defaults',
      started_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      stopped_at TEXT
    );
    INSERT OR IGNORE INTO autopilot_sessions_new (
      id, workspace_id, owner_user_id, title, mode, status, channel_scope_json,
      policy_profile_name, policy_override_raw, policy_json, session_context_json,
      runtime_revision_json, last_runtime_refresh_at, policy_binding, channel_scope_binding,
      started_at, ends_at, stopped_at
    )
    SELECT id, workspace_id, owner_user_id, title, mode, status, channel_scope_json,
           ${sqlColumn(columns, 'policy_profile_name', 'NULL')},
           ${sqlColumn(columns, 'policy_override_raw', 'NULL')},
           ${sqlColumn(columns, 'policy_json', 'NULL')},
           ${sqlColumn(columns, 'session_context_json', 'NULL')},
           ${sqlColumn(columns, 'runtime_revision_json', 'NULL')},
           ${sqlColumn(columns, 'last_runtime_refresh_at', 'NULL')},
           ${sqlColumn(columns, 'policy_binding', `'config'`)},
           ${sqlColumn(columns, 'channel_scope_binding', `'setup_defaults'`)},
           started_at, ends_at, stopped_at
    FROM autopilot_sessions;
    DROP TABLE autopilot_sessions;
    ALTER TABLE autopilot_sessions_new RENAME TO autopilot_sessions;
  `);
}

function rebuildThreadStates(db: Database.Database): void {
  if (!tableExists(db, 'thread_states')) return;
  db.exec(`
    CREATE TABLE thread_states_new (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      target_user_id TEXT,
      last_message_ts TEXT NOT NULL,
      continuity_case TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL,
      next_heartbeat_at TEXT,
      UNIQUE(workspace_id, channel_id, thread_ts)
    );
    INSERT OR IGNORE INTO thread_states_new (
      id, workspace_id, session_id, channel_id, thread_ts, target_user_id,
      last_message_ts, continuity_case, summary, status, next_heartbeat_at
    )
    SELECT id, workspace_id, session_id, channel_id, thread_ts, target_user_id,
           last_message_ts, continuity_case, summary, status, next_heartbeat_at
    FROM thread_states;
    DROP TABLE thread_states;
    ALTER TABLE thread_states_new RENAME TO thread_states;
  `);
}

function rebuildContinuityActions(db: Database.Database): void {
  if (!tableExists(db, 'continuity_actions')) return;
  db.exec(`
    CREATE TABLE continuity_actions_new (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      target_user_id TEXT,
      action_type TEXT NOT NULL,
      disposition TEXT NOT NULL,
      message TEXT NOT NULL,
      reason TEXT NOT NULL,
      confidence REAL NOT NULL,
      provider TEXT,
      context_snapshot_json TEXT,
      created_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO continuity_actions_new (
      id, workspace_id, session_id, channel_id, thread_ts, target_user_id,
      action_type, disposition, message, reason, confidence, provider,
      context_snapshot_json, created_at
    )
    SELECT id, workspace_id, session_id, channel_id, thread_ts, target_user_id,
           action_type, disposition, message, reason, confidence, provider,
           context_snapshot_json, created_at
    FROM continuity_actions;
    DROP TABLE continuity_actions;
    ALTER TABLE continuity_actions_new RENAME TO continuity_actions;
  `);
}

function rebuildAgentRuns(db: Database.Database): void {
  if (!tableExists(db, 'agent_runs')) return;
  db.exec(`
    CREATE TABLE agent_runs_new (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      task_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      target_user_id TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
    INSERT OR IGNORE INTO agent_runs_new (
      id, workspace_id, session_id, task_id, channel_id, thread_ts,
      target_user_id, status, started_at, completed_at
    )
    SELECT id, workspace_id, session_id, task_id, channel_id, thread_ts,
           target_user_id, status, started_at, completed_at
    FROM agent_runs;
    DROP TABLE agent_runs;
    ALTER TABLE agent_runs_new RENAME TO agent_runs;
  `);
}

function rebuildReminders(db: Database.Database): void {
  if (!tableExists(db, 'reminders')) return;
  db.exec(`
    CREATE TABLE reminders_new (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      target_user_id TEXT,
      due_at TEXT NOT NULL,
      status TEXT NOT NULL
    );
    INSERT OR IGNORE INTO reminders_new (
      id, workspace_id, session_id, channel_id, thread_ts, target_user_id, due_at, status
    )
    SELECT id, workspace_id, session_id, channel_id, thread_ts, target_user_id, due_at, status
    FROM reminders;
    DROP TABLE reminders;
    ALTER TABLE reminders_new RENAME TO reminders;
  `);
}

export const teamScopedRuntime: Migration = {
  id: '011_team_scoped_runtime',
  description: 'allow team-scoped runtime records without user targets',
  destructive: true,
  up(db) {
    rebuildAutopilotSessions(db);
    rebuildThreadStates(db);
    rebuildContinuityActions(db);
    rebuildAgentRuns(db);
    rebuildReminders(db);
  }
};
