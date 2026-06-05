import type { Db } from './common.js';

export type SourceIndexRunStatus = 'running' | 'indexed' | 'skipped' | 'failed';

export interface SourceIndexRunRecord {
  id: string;
  workspaceId: string;
  provider: string;
  status: SourceIndexRunStatus;
  resourceCount: number;
  changedPaths: string[];
  cursor?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
}

interface SourceIndexRunRow {
  id: string;
  workspace_id: string;
  provider: string;
  status: SourceIndexRunStatus;
  resource_count: number;
  changed_paths_json: string;
  cursor?: string;
  error?: string;
  started_at: string;
  completed_at?: string;
  updated_at: string;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function mapRow(row: SourceIndexRunRow): SourceIndexRunRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    status: row.status,
    resourceCount: row.resource_count,
    changedPaths: parseJsonArray(row.changed_paths_json),
    cursor: row.cursor,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  };
}

export function startSourceIndexRun(db: Db, input: { id: string; workspaceId: string; provider: string }): SourceIndexRunRecord {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO source_index_runs (
      id, workspace_id, provider, status, resource_count, changed_paths_json, started_at, updated_at
    ) VALUES (?, ?, ?, 'running', 0, '[]', ?, ?)
  `).run(input.id, input.workspaceId, input.provider, now, now);
  return getSourceIndexRun(db, input.id) as SourceIndexRunRecord;
}

export function finishSourceIndexRun(
  db: Db,
  input: {
    id: string;
    status: Extract<SourceIndexRunStatus, 'indexed' | 'skipped'>;
    resourceCount: number;
    changedPaths: string[];
    cursor?: string;
  }
): SourceIndexRunRecord {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE source_index_runs
    SET status = ?,
        resource_count = ?,
        changed_paths_json = ?,
        cursor = ?,
        error = NULL,
        completed_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(input.status, input.resourceCount, JSON.stringify(input.changedPaths), input.cursor ?? null, now, now, input.id);
  return getSourceIndexRun(db, input.id) as SourceIndexRunRecord;
}

export function failSourceIndexRun(db: Db, input: { id: string; error: string }): SourceIndexRunRecord {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE source_index_runs
    SET status = 'failed',
        error = ?,
        completed_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(input.error, now, now, input.id);
  return getSourceIndexRun(db, input.id) as SourceIndexRunRecord;
}

export function getSourceIndexRun(db: Db, id: string): SourceIndexRunRecord | undefined {
  const row = db.prepare(`SELECT * FROM source_index_runs WHERE id = ?`).get(id) as SourceIndexRunRow | undefined;
  return row ? mapRow(row) : undefined;
}

export function listSourceIndexRuns(db: Db, input: { workspaceId?: string; limit?: number } = {}): SourceIndexRunRecord[] {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const rows = input.workspaceId
    ? db.prepare(`
        SELECT * FROM source_index_runs
        WHERE workspace_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(input.workspaceId, limit) as SourceIndexRunRow[]
    : db.prepare(`
        SELECT * FROM source_index_runs
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(limit) as SourceIndexRunRow[];
  return rows.map(mapRow);
}

export function latestSourceIndexRunForProvider(
  db: Db,
  input: { workspaceId: string; provider: string }
): SourceIndexRunRecord | undefined {
  const row = db.prepare(`
    SELECT * FROM source_index_runs
    WHERE workspace_id = ? AND provider = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(input.workspaceId, input.provider) as SourceIndexRunRow | undefined;
  return row ? mapRow(row) : undefined;
}
