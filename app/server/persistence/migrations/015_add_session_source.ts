import { columnNames, tableExists } from './helpers.js';
import type { Migration } from './types.js';

export const addSessionSource: Migration = {
  id: '015_add_session_source',
  description: 'track manual versus scheduled coverage sessions',
  up(db) {
    if (!tableExists(db, 'autopilot_sessions')) return;
    const columns = columnNames(db, 'autopilot_sessions');
    if (!columns.has('source')) {
      db.exec(`ALTER TABLE autopilot_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';`);
    }
  }
};
