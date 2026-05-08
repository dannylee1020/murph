import { randomUUID } from 'node:crypto';
import type {
  ActionContextSnapshot,
  ActionDisposition,
  ContinuityActionType,
  ContinuityCase,
  ProviderName,
  ReviewItem,
  TriageItem
} from '#lib/types';
import type { Db } from './_shared.js';

export interface ActionInput {
  workspaceId: string;
  sessionId?: string;
  channelId: string;
  threadTs: string;
  targetUserId: string;
  actionType: ContinuityActionType;
  disposition: ActionDisposition;
  message: string;
  reason: string;
  confidence: number;
  provider?: ProviderName;
  contextSnapshot?: ActionContextSnapshot;
}

interface ActionRow {
  id: string;
  workspace_id: string;
  session_id?: string;
  thread_ts: string;
  channel_id: string;
  target_user_id: string;
  action_type: ContinuityActionType;
  disposition: ActionDisposition;
  message: string;
  reason: string;
  confidence: number;
  provider?: ProviderName;
  context_snapshot_json?: string | null;
  created_at: string;
}

function mapAction(row: ActionRow): ReviewItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    threadTs: row.thread_ts,
    channelId: row.channel_id,
    targetUserId: row.target_user_id,
    action: row.action_type,
    disposition: row.disposition,
    message: row.message,
    reason: row.reason,
    confidence: row.confidence,
    provider: row.provider,
    createdAt: row.created_at
  };
}

function parseContextSnapshot(value: string | null | undefined): ActionContextSnapshot | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as ActionContextSnapshot;
    if (
      !parsed ||
      typeof parsed.summary !== 'string' ||
      typeof parsed.continuityCase !== 'string' ||
      !parsed.thread ||
      !Array.isArray(parsed.thread.messages)
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function insertAction(db: Db, input: ActionInput): ReviewItem {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO continuity_actions (
      id, workspace_id, session_id, channel_id, thread_ts, target_user_id, action_type,
      disposition, message, reason, confidence, provider, context_snapshot_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.workspaceId,
    input.sessionId ?? null,
    input.channelId,
    input.threadTs,
    input.targetUserId,
    input.actionType,
    input.disposition,
    input.message,
    input.reason,
    input.confidence,
    input.provider ?? null,
    input.contextSnapshot ? JSON.stringify(input.contextSnapshot) : null,
    createdAt
  );

  return {
    id,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    threadTs: input.threadTs,
    channelId: input.channelId,
    targetUserId: input.targetUserId,
    action: input.actionType,
    disposition: input.disposition,
    message: input.message,
    reason: input.reason,
    confidence: input.confidence,
    provider: input.provider,
    createdAt
  };
}

export function getReviewItem(db: Db, id: string): ReviewItem | undefined {
  const row = db
    .prepare(
      `SELECT id, workspace_id, session_id, thread_ts, channel_id, target_user_id, action_type,
              disposition, message, reason, confidence, provider, context_snapshot_json, created_at
       FROM continuity_actions
       WHERE id = ?`
    )
    .get(id) as ActionRow | undefined;
  return row ? mapAction(row) : undefined;
}

export function updateReviewItem(
  db: Db,
  id: string,
  input: {
    disposition?: ActionDisposition;
    message?: string;
    reason?: string;
    action?: ContinuityActionType;
  }
): ReviewItem | undefined {
  const existing = getReviewItem(db, id);

  if (!existing) {
    return undefined;
  }

  db.prepare(
    `UPDATE continuity_actions
     SET action_type = ?, disposition = ?, message = ?, reason = ?
     WHERE id = ?`
  ).run(
    input.action ?? existing.action,
    input.disposition ?? existing.disposition ?? 'queued',
    input.message ?? existing.message,
    input.reason ?? existing.reason,
    id
  );

  return getReviewItem(db, id);
}

export function listReviewQueue(db: Db, workspaceId?: string, sessionId?: string): ReviewItem[] {
  const args: string[] = [];
  const where: string[] = [`disposition = 'queued'`];

  if (workspaceId) {
    where.push(`workspace_id = ?`);
    args.push(workspaceId);
  }

  if (sessionId) {
    where.push(`session_id = ?`);
    args.push(sessionId);
  }

  const rows = db
    .prepare(
      `SELECT id, workspace_id, session_id, thread_ts, channel_id, target_user_id, action_type, message, reason, created_at
       FROM continuity_actions
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC`
    )
    .all(...args) as Array<{
    id: string;
    workspace_id: string;
    session_id?: string;
    thread_ts: string;
    channel_id: string;
    target_user_id: string;
    action_type: ContinuityActionType;
    message: string;
    reason: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    threadTs: row.thread_ts,
    channelId: row.channel_id,
    targetUserId: row.target_user_id,
    action: row.action_type,
    disposition: 'queued',
    message: row.message,
    reason: row.reason,
    createdAt: row.created_at
  }));
}

export function listTriageItems(db: Db, workspaceId?: string, sessionId?: string): TriageItem[] {
  const args: string[] = [];
  const where: string[] = [`ca.disposition IN ('auto_sent', 'abstained')`];

  if (workspaceId) {
    where.push(`ca.workspace_id = ?`);
    args.push(workspaceId);
  }

  if (sessionId) {
    where.push(`ca.session_id = ?`);
    args.push(sessionId);
  }

  const rows = db
    .prepare(
      `SELECT ca.id, ca.workspace_id, ca.session_id, ca.thread_ts, ca.channel_id, ca.target_user_id,
              ca.action_type, ca.disposition, ca.message, ca.reason, ca.confidence, ca.provider,
              ca.context_snapshot_json, ca.created_at,
              ts.summary AS fallback_summary, ts.continuity_case AS fallback_continuity_case
       FROM continuity_actions ca
       LEFT JOIN thread_states ts
         ON ts.workspace_id = ca.workspace_id
        AND ts.channel_id = ca.channel_id
        AND ts.thread_ts = ca.thread_ts
       WHERE ${where.join(' AND ')}
       ORDER BY ca.created_at DESC`
    )
    .all(...args) as Array<ActionRow & {
    fallback_summary?: string | null;
    fallback_continuity_case?: ContinuityCase | null;
  }>;

  return rows.map((row) => {
    const item = mapAction(row) as TriageItem;
    item.contextSnapshot =
      parseContextSnapshot(row.context_snapshot_json) ??
      (row.fallback_summary
        ? {
            summary: row.fallback_summary,
            continuityCase: row.fallback_continuity_case ?? 'unknown',
            thread: {
              channelId: row.channel_id,
              threadTs: row.thread_ts,
              messages: []
            }
          }
        : undefined);
    return item;
  });
}
