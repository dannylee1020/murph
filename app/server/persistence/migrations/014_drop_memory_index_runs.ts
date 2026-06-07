import type { Migration } from './types.js';
import { tableExists } from './helpers.js';

export const dropMemoryIndexRuns: Migration = {
  id: '014_drop_memory_index_runs',
  description: 'remove unused generated markdown memory indexing state',
  destructive: true,
  shouldBackup(db) {
    return tableExists(db, 'memory_index_runs');
  },
  up(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_memory_index_runs_status;
      DROP TABLE IF EXISTS memory_index_runs;
    `);
  }
};
