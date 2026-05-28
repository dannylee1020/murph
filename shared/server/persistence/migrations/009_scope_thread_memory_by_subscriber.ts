import { columnNames, tableExists } from './helpers.js';
import type { Migration } from './types.js';

export const scopeThreadMemoryBySubscriber: Migration = {
  id: '009_scope_thread_memory_by_subscriber',
  description: 'scope thread memory rows by target subscriber',
  up(db) {
    if (!tableExists(db, 'thread_memory')) {
      return;
    }

    if (columnNames(db, 'thread_memory').has('target_user_id')) {
      return;
    }

    db.exec(`
      CREATE TABLE thread_memory_new (
        workspace_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        thread_ts TEXT NOT NULL,
        target_user_id TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL,
        PRIMARY KEY (workspace_id, channel_id, thread_ts, target_user_id)
      );

      INSERT OR IGNORE INTO thread_memory_new (
        workspace_id, channel_id, thread_ts, target_user_id, data_json
      )
      SELECT workspace_id, channel_id, thread_ts, '', data_json
      FROM thread_memory;

      DROP TABLE thread_memory;
      ALTER TABLE thread_memory_new RENAME TO thread_memory;
    `);
  }
};
