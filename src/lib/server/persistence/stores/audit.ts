import type {
  ActionDisposition,
  AuditRecord,
  ContinuityActionType,
  ProviderName
} from '#lib/types';
import type { Db } from './_shared.js';

export function insertAudit(db: Db, input: AuditRecord): void {
  db.prepare(
    `INSERT INTO audit_entries (
      id, task_id, workspace_id, session_id, thread_ts, action_type, disposition, policy_reason,
      model_reason, confidence, provider, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.taskId,
    input.workspaceId,
    input.sessionId ?? null,
    input.threadTs,
    input.action,
    input.disposition,
    input.policyReason,
    input.modelReason,
    input.confidence,
    input.provider ?? null,
    input.createdAt
  );
}

export function listAudit(db: Db, workspaceId?: string, limit = 50): AuditRecord[] {
  const rows = db
    .prepare(
      workspaceId
        ? `SELECT id, task_id, workspace_id, session_id, thread_ts, action_type, disposition,
                  policy_reason, model_reason, confidence, provider, created_at
           FROM audit_entries
           WHERE workspace_id = ?
           ORDER BY created_at DESC
           LIMIT ?`
        : `SELECT id, task_id, workspace_id, session_id, thread_ts, action_type, disposition,
                  policy_reason, model_reason, confidence, provider, created_at
           FROM audit_entries
           ORDER BY created_at DESC
           LIMIT ?`
    )
    .all(...(workspaceId ? [workspaceId, limit] : [limit])) as Array<{
    id: string;
    task_id: string;
    workspace_id: string;
    session_id?: string;
    thread_ts: string;
    action_type: ContinuityActionType;
    disposition: ActionDisposition;
    policy_reason: string;
    model_reason: string;
    confidence: number;
    provider?: ProviderName;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    threadTs: row.thread_ts,
    action: row.action_type,
    disposition: row.disposition,
    policyReason: row.policy_reason,
    modelReason: row.model_reason,
    confidence: row.confidence,
    provider: row.provider,
    createdAt: row.created_at
  }));
}
