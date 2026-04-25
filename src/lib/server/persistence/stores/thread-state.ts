import { randomUUID } from 'node:crypto';
import type { ContinuityCase, ThreadStateRecord } from '#lib/types';
import type { Db } from './_shared.js';

export interface ThreadStateInput {
  workspaceId: string;
  sessionId?: string;
  channelId: string;
  threadTs: string;
  targetUserId: string;
  lastMessageTs: string;
  continuityCase: ContinuityCase;
  summary?: string;
  status: string;
  nextHeartbeatAt?: string;
}

export function getThreadState(
  db: Db,
  workspaceId: string,
  channelId: string,
  threadTs: string
): ThreadStateRecord | undefined {
  const row = db
    .prepare(
      `SELECT workspace_id, session_id, channel_id, thread_ts, target_user_id, last_message_ts,
              continuity_case, summary, status, next_heartbeat_at
       FROM thread_states
       WHERE workspace_id = ? AND channel_id = ? AND thread_ts = ?`
    )
    .get(workspaceId, channelId, threadTs) as
    | {
        workspace_id: string;
        session_id?: string;
        channel_id: string;
        thread_ts: string;
        target_user_id: string;
        last_message_ts: string;
        continuity_case: ContinuityCase;
        summary?: string;
        status: string;
        next_heartbeat_at?: string;
      }
    | undefined;

  if (!row) {
    return undefined;
  }

  return {
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    targetUserId: row.target_user_id,
    lastMessageTs: row.last_message_ts,
    continuityCase: row.continuity_case,
    summary: row.summary,
    status: row.status,
    nextHeartbeatAt: row.next_heartbeat_at
  };
}

export function upsertThreadState(db: Db, input: ThreadStateInput): void {
  const id =
    (
      db
        .prepare(
          `SELECT id FROM thread_states WHERE workspace_id = ? AND channel_id = ? AND thread_ts = ?`
        )
        .get(input.workspaceId, input.channelId, input.threadTs) as { id: string } | undefined
    )?.id ?? randomUUID();

  db.prepare(
    `INSERT INTO thread_states (
      id, workspace_id, session_id, channel_id, thread_ts, target_user_id, last_message_ts,
      continuity_case, summary, status, next_heartbeat_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, channel_id, thread_ts) DO UPDATE SET
      session_id = excluded.session_id,
      target_user_id = excluded.target_user_id,
      last_message_ts = excluded.last_message_ts,
      continuity_case = excluded.continuity_case,
      summary = excluded.summary,
      status = excluded.status,
      next_heartbeat_at = excluded.next_heartbeat_at`
  ).run(
    id,
    input.workspaceId,
    input.sessionId ?? null,
    input.channelId,
    input.threadTs,
    input.targetUserId,
    input.lastMessageTs,
    input.continuityCase,
    input.summary ?? null,
    input.status,
    input.nextHeartbeatAt ?? null
  );
}
