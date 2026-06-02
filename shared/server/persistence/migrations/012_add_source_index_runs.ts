import type { Migration } from './types.js';

export const addSourceIndexRuns: Migration = {
  id: '012_add_source_index_runs',
  description: 'track source index refresh progress',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS source_index_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        resource_count INTEGER NOT NULL DEFAULT 0,
        changed_paths_json TEXT NOT NULL DEFAULT '[]',
        cursor TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_source_index_runs_workspace_provider
        ON source_index_runs(workspace_id, provider, updated_at);
    `);
  }
};
