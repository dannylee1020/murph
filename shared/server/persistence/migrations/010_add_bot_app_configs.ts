import type { Migration } from './types.js';

export const addBotAppConfigs: Migration = {
  id: '010_add_bot_app_configs',
  description: 'add bot app configs',
  up(db) {
    db.exec(`
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
    `);
  }
};
