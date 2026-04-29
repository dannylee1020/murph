import { randomUUID } from 'node:crypto';
import type { RecurringJobRecord } from '#lib/types';
import type { Db } from './_shared.js';
import { parseJsonObject } from './_shared.js';

export interface RecurringJobInput {
  workspaceId: string;
  sessionId?: string;
  jobType: RecurringJobRecord['jobType'];
  localTime: string;
  timezone: string;
  payload: RecurringJobRecord['payload'];
  nextRunAt: string;
  status?: RecurringJobRecord['status'];
}

interface RecurringJobRow {
  id: string;
  workspace_id: string;
  session_id?: string;
  job_type: RecurringJobRecord['jobType'];
  local_time: string;
  timezone: string;
  payload_json: string;
  next_run_at: string;
  status: RecurringJobRecord['status'];
  created_at: string;
}

function mapRecurringJob(row: RecurringJobRow): RecurringJobRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    jobType: row.job_type,
    localTime: row.local_time,
    timezone: row.timezone,
    payload: parseJsonObject<RecurringJobRecord['payload']>(row.payload_json, {
      channelId: '',
      ownerUserId: ''
    }),
    nextRunAt: row.next_run_at,
    status: row.status,
    createdAt: row.created_at
  };
}

export function createRecurringJob(db: Db, input: RecurringJobInput): RecurringJobRecord {
  const job: RecurringJobRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    jobType: input.jobType,
    localTime: input.localTime,
    timezone: input.timezone,
    payload: input.payload,
    nextRunAt: input.nextRunAt,
    status: input.status ?? 'active',
    createdAt: new Date().toISOString()
  };

  db.prepare(
    `INSERT INTO recurring_jobs (
      id, workspace_id, session_id, job_type, local_time, timezone, payload_json, next_run_at, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    job.id,
    job.workspaceId,
    job.sessionId ?? null,
    job.jobType,
    job.localTime,
    job.timezone,
    JSON.stringify(job.payload),
    job.nextRunAt,
    job.status,
    job.createdAt
  );

  return job;
}

export function listRecurringJobs(db: Db, sessionId?: string): RecurringJobRecord[] {
  const rows = db
    .prepare(
      sessionId
        ? `SELECT * FROM recurring_jobs WHERE session_id = ? ORDER BY next_run_at ASC`
        : `SELECT * FROM recurring_jobs ORDER BY next_run_at ASC`
    )
    .all(...(sessionId ? [sessionId] : [])) as RecurringJobRow[];

  return rows.map(mapRecurringJob);
}

export function listDueRecurringJobs(db: Db, nowIso: string): RecurringJobRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM recurring_jobs
       WHERE status = 'active' AND next_run_at <= ?
       ORDER BY next_run_at ASC`
    )
    .all(nowIso) as RecurringJobRow[];

  return rows.map(mapRecurringJob);
}

export function updateRecurringJobNextRun(
  db: Db,
  id: string,
  nextRunAt: string
): RecurringJobRecord | undefined {
  db.prepare(`UPDATE recurring_jobs SET next_run_at = ? WHERE id = ?`).run(nextRunAt, id);
  return getRecurringJob(db, id);
}

export function deleteRecurringJob(db: Db, id: string): boolean {
  const result = db.prepare(`DELETE FROM recurring_jobs WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getRecurringJob(db: Db, id: string): RecurringJobRecord | undefined {
  const row = db.prepare(`SELECT * FROM recurring_jobs WHERE id = ?`).get(id) as
    | RecurringJobRow
    | undefined;
  return row ? mapRecurringJob(row) : undefined;
}
