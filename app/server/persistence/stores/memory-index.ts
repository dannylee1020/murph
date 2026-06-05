import type { AgentRunRecord } from '#app/types';
import type { Db } from './common.js';

export type MemoryIndexRunStatus = 'queued' | 'indexed' | 'failed' | 'skipped';

export interface MemoryIndexRunRecord {
  runId: string;
  status: MemoryIndexRunStatus;
  attempts: number;
  contentHash?: string;
  error?: string;
  indexedAt?: string;
  updatedAt: string;
}

interface MemoryIndexRow {
  run_id: string;
  status: MemoryIndexRunStatus;
  attempts: number;
  content_hash?: string;
  error?: string;
  indexed_at?: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  workspace_id: string;
  session_id?: string;
  task_id: string;
  channel_id: string;
  thread_ts: string;
  target_user_id: string;
  status: AgentRunRecord['status'];
  started_at: string;
  completed_at?: string;
}

function mapIndexRow(row: MemoryIndexRow): MemoryIndexRunRecord {
  return {
    runId: row.run_id,
    status: row.status,
    attempts: row.attempts,
    contentHash: row.content_hash,
    error: row.error,
    indexedAt: row.indexed_at,
    updatedAt: row.updated_at
  };
}

function mapRun(row: RunRow): AgentRunRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    taskId: row.task_id,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    targetUserId: row.target_user_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export function getMemoryIndexRun(db: Db, runId: string): MemoryIndexRunRecord | undefined {
  const row = db
    .prepare(`SELECT * FROM memory_index_runs WHERE run_id = ?`)
    .get(runId) as MemoryIndexRow | undefined;
  return row ? mapIndexRow(row) : undefined;
}

export function markMemoryIndexQueued(db: Db, runId: string): MemoryIndexRunRecord {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO memory_index_runs (run_id, status, attempts, updated_at)
    VALUES (?, 'queued', 0, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      status = CASE
        WHEN memory_index_runs.status = 'indexed' THEN memory_index_runs.status
        ELSE 'queued'
      END,
      error = CASE
        WHEN memory_index_runs.status = 'indexed' THEN memory_index_runs.error
        ELSE NULL
      END,
      updated_at = excluded.updated_at
  `).run(runId, now);
  return getMemoryIndexRun(db, runId) as MemoryIndexRunRecord;
}

export function markMemoryIndexIndexed(
  db: Db,
  runId: string,
  contentHash: string,
  status: Extract<MemoryIndexRunStatus, 'indexed' | 'skipped'> = 'indexed'
): MemoryIndexRunRecord {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO memory_index_runs (run_id, status, attempts, content_hash, error, indexed_at, updated_at)
    VALUES (?, ?, 1, ?, NULL, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      status = excluded.status,
      attempts = memory_index_runs.attempts + 1,
      content_hash = excluded.content_hash,
      error = NULL,
      indexed_at = excluded.indexed_at,
      updated_at = excluded.updated_at
  `).run(runId, status, contentHash, now, now);
  return getMemoryIndexRun(db, runId) as MemoryIndexRunRecord;
}

export function markMemoryIndexFailed(db: Db, runId: string, error: string): MemoryIndexRunRecord {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO memory_index_runs (run_id, status, attempts, error, updated_at)
    VALUES (?, 'failed', 1, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      status = 'failed',
      attempts = memory_index_runs.attempts + 1,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run(runId, error, now);
  return getMemoryIndexRun(db, runId) as MemoryIndexRunRecord;
}

export function listMemoryIndexBacklog(db: Db, limit = 20): AgentRunRecord[] {
  const rows = db.prepare(`
    SELECT r.*
    FROM agent_runs r
    LEFT JOIN memory_index_runs m ON m.run_id = r.id
    WHERE r.status = 'completed'
      AND (m.run_id IS NULL OR m.status IN ('queued', 'failed'))
      AND COALESCE(m.attempts, 0) < 3
    ORDER BY r.completed_at ASC, r.started_at ASC
    LIMIT ?
  `).all(limit) as RunRow[];
  return rows.map(mapRun);
}
