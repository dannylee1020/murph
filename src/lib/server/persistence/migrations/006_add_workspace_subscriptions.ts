import { tableExists } from './helpers.js';
import type { Migration } from './types.js';

export const addWorkspaceSubscriptions: Migration = {
  id: '006_add_workspace_subscriptions',
  description: 'track shared bot subscriptions per workspace user',
  up(db) {
    if (!tableExists(db, 'workspace_subscriptions')) {
      db.exec(`
        CREATE TABLE workspace_subscriptions (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          external_user_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          channel_scope_mode TEXT NOT NULL DEFAULT 'selected',
          channel_scope_json TEXT NOT NULL DEFAULT '[]',
          timezone TEXT,
          workday_start_hour INTEGER,
          workday_end_hour INTEGER,
          policy_profile_name TEXT,
          dashboard_token_hash TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(workspace_id, external_user_id)
        );
      `);
    }

    if (!tableExists(db, 'direct_conversations')) {
      db.exec(`
        CREATE TABLE direct_conversations (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          bot_installation_id TEXT,
          workspace_id TEXT,
          external_user_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          last_selected_workspace_id TEXT,
          last_seen_at TEXT NOT NULL,
          UNIQUE(provider, channel_id)
        );
      `);
    }
  }
};
