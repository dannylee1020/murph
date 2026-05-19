import type { Migration } from './types.js';

export const addChannelEvents: Migration = {
  id: '003_add_channel_events',
  description: 'add provider-neutral channel event ledger',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS channel_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
    `);
  }
};
