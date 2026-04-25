import type {
  ActionDisposition,
  ContinuityActionType,
  MorningBriefing,
  WorkspaceSummary
} from '#lib/types';
import type { Db } from './_shared.js';
import { listReviewQueue } from './action.js';
import { getOrCreateWorkspaceMemory } from './memory.js';
import { getProviderSettings } from './provider-settings.js';
import { getSessionById } from './session.js';
import { getFirstWorkspace } from './workspace.js';

export function getMorningBriefing(db: Db, sessionId: string): MorningBriefing | undefined {
  const session = getSessionById(db, sessionId);

  if (!session) {
    return undefined;
  }

  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN disposition = 'auto_sent' THEN 1 ELSE 0 END) AS handled_count,
         SUM(CASE WHEN disposition = 'queued' THEN 1 ELSE 0 END) AS queued_count,
         SUM(CASE WHEN disposition = 'abstained' THEN 1 ELSE 0 END) AS abstained_count,
         SUM(CASE WHEN disposition = 'failed' THEN 1 ELSE 0 END) AS failed_count
       FROM continuity_actions
       WHERE session_id = ?`
    )
    .get(sessionId) as {
    handled_count: number | null;
    queued_count: number | null;
    abstained_count: number | null;
    failed_count: number | null;
  };

  const notableRows = db
    .prepare(
      `SELECT thread_ts, channel_id, action_type, disposition, reason, created_at
       FROM continuity_actions
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT 10`
    )
    .all(sessionId) as Array<{
    thread_ts: string;
    channel_id: string;
    action_type: ContinuityActionType;
    disposition: ActionDisposition;
    reason: string;
    created_at: string;
  }>;

  return {
    session,
    handledCount: counts.handled_count ?? 0,
    queuedCount: counts.queued_count ?? 0,
    abstainedCount: counts.abstained_count ?? 0,
    failedCount: counts.failed_count ?? 0,
    unresolvedItems: listReviewQueue(db, undefined, sessionId),
    notableThreads: notableRows.map((row) => ({
      threadTs: row.thread_ts,
      channelId: row.channel_id,
      action: row.action_type,
      disposition: row.disposition,
      reason: row.reason,
      createdAt: row.created_at
    }))
  };
}

export function getLatestBriefing(db: Db, workspaceId: string): MorningBriefing | undefined {
  const row = db
    .prepare(
      `SELECT id FROM autopilot_sessions
       WHERE workspace_id = ? AND status IN ('stopped', 'expired')
       ORDER BY COALESCE(stopped_at, ends_at) DESC
       LIMIT 1`
    )
    .get(workspaceId) as { id: string } | undefined;

  return row ? getMorningBriefing(db, row.id) : undefined;
}

export function getWorkspaceSummary(db: Db): WorkspaceSummary {
  const workspace = getFirstWorkspace(db);
  const userCount = db.prepare(`SELECT COUNT(*) as count FROM users`).get() as { count: number };
  const queuedCount = db
    .prepare(`SELECT COUNT(*) as count FROM continuity_actions WHERE disposition = 'queued'`)
    .get() as { count: number };
  const reminderCount = db
    .prepare(`SELECT COUNT(*) as count FROM reminders WHERE status = 'pending'`)
    .get() as { count: number };
  const activeSessionCount = db
    .prepare(`SELECT COUNT(*) as count FROM autopilot_sessions WHERE status = 'active'`)
    .get() as { count: number };
  const pluginMemory = workspace ? getOrCreateWorkspaceMemory(db, workspace.id) : undefined;

  return {
    workspace,
    provider: workspace ? getProviderSettings(db, workspace.id) : undefined,
    userCount: userCount.count,
    queuedCount: queuedCount.count,
    reminderCount: reminderCount.count,
    activeSessionCount: activeSessionCount.count,
    latestBriefing: workspace ? getLatestBriefing(db, workspace.id) : undefined,
    pluginCount: pluginMemory?.enabledPlugins.length ?? 0
  };
}
