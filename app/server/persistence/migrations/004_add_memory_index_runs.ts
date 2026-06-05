import type { Migration } from './types.js';

export const addMemoryIndexRuns: Migration = {
  id: '004_add_memory_index_runs',
  description: 'track markdown memory indexing progress',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_index_runs (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT,
        error TEXT,
        indexed_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_index_runs_status
        ON memory_index_runs(status, updated_at);
    `);
  }
};
