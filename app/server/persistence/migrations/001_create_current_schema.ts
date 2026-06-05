import type { Migration } from './types.js';

export const createCurrentSchema: Migration = {
  id: '001_create_current_schema',
  description: 'create current sqlite schema',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        external_workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        bot_user_id TEXT,
        installed_at TEXT NOT NULL,
        UNIQUE(provider, external_workspace_id)
      );

      CREATE TABLE IF NOT EXISTS bot_installations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        role TEXT NOT NULL,
        external_workspace_id TEXT NOT NULL,
        bot_user_id TEXT,
        app_id TEXT,
        represented_user_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, external_workspace_id, role)
      );

      CREATE TABLE IF NOT EXISTS bot_app_configs (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        role TEXT NOT NULL,
        app_id TEXT,
        client_id TEXT,
        public_key TEXT,
        events_mode TEXT,
        redirect_uri TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, role)
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

	      CREATE TABLE IF NOT EXISTS channel_events (
	        id TEXT PRIMARY KEY,
	        provider TEXT NOT NULL,
	        workspace_id TEXT NOT NULL,
	        dedupe_key TEXT NOT NULL UNIQUE,
	        event_type TEXT NOT NULL,
	        payload_json TEXT NOT NULL,
	        received_at TEXT NOT NULL
	      );

	      CREATE TABLE IF NOT EXISTS autopilot_sessions (
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
        target_user_id TEXT,
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
        target_user_id TEXT,
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
        target_user_id TEXT,
        due_at TEXT NOT NULL,
        status TEXT NOT NULL
      );

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
        target_user_id TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL,
        PRIMARY KEY (workspace_id, channel_id, thread_ts, target_user_id)
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
  }
};
