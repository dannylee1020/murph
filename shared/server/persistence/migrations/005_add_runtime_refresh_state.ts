import { columnNames, tableExists } from './helpers.js';
import type { Migration } from './types.js';

export const addRuntimeRefreshState: Migration = {
  id: '005_add_runtime_refresh_state',
  description: 'track runtime refresh revisions for active sessions',
  up(db) {
    const sessionColumns = columnNames(db, 'autopilot_sessions');
    if (sessionColumns.size > 0) {
      if (!sessionColumns.has('runtime_revision_json')) {
        db.exec(`ALTER TABLE autopilot_sessions ADD COLUMN runtime_revision_json TEXT;`);
      }
      if (!sessionColumns.has('last_runtime_refresh_at')) {
        db.exec(`ALTER TABLE autopilot_sessions ADD COLUMN last_runtime_refresh_at TEXT;`);
      }
      if (!sessionColumns.has('policy_binding')) {
        db.exec(`ALTER TABLE autopilot_sessions ADD COLUMN policy_binding TEXT NOT NULL DEFAULT 'config';`);
      }
      if (!sessionColumns.has('channel_scope_binding')) {
        db.exec(`ALTER TABLE autopilot_sessions ADD COLUMN channel_scope_binding TEXT NOT NULL DEFAULT 'setup_defaults';`);
      }
    }

    if (!tableExists(db, 'runtime_refresh_state')) {
      db.exec(`
        CREATE TABLE runtime_refresh_state (
          scope_key TEXT PRIMARY KEY,
          pending INTEGER NOT NULL DEFAULT 0,
          pending_reasons_json TEXT NOT NULL DEFAULT '[]',
          last_revision_json TEXT,
          updated_at TEXT NOT NULL
        );
      `);
    }
  }
};
