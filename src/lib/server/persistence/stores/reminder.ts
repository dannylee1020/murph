import { randomUUID } from 'node:crypto';
import type { ReminderRecord } from '#lib/types';
import type { Db } from './_shared.js';

export function scheduleReminder(
  db: Db,
  input: Omit<ReminderRecord, 'id' | 'status'>
): ReminderRecord {
  const reminder: ReminderRecord = {
    id: randomUUID(),
    status: 'pending',
    ...input
  };

  db.prepare(
    `INSERT INTO reminders (id, workspace_id, session_id, channel_id, thread_ts, target_user_id, due_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    reminder.id,
    reminder.workspaceId,
    reminder.sessionId ?? null,
    reminder.channelId,
    reminder.threadTs,
    reminder.targetUserId,
    reminder.dueAt,
    reminder.status
  );

  return reminder;
}

export function listDueReminders(db: Db, nowIso: string): ReminderRecord[] {
  const rows = db
    .prepare(
      `SELECT id, workspace_id, session_id, channel_id, thread_ts, target_user_id, due_at, status
       FROM reminders
       WHERE status = 'pending' AND due_at <= ?
       ORDER BY due_at ASC`
    )
    .all(nowIso) as Array<{
    id: string;
    workspace_id: string;
    session_id?: string;
    channel_id: string;
    thread_ts: string;
    target_user_id: string;
    due_at: string;
    status: ReminderRecord['status'];
  }>;

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    targetUserId: row.target_user_id,
    dueAt: row.due_at,
    status: row.status
  }));
}

export function markReminderStatus(db: Db, id: string, status: ReminderRecord['status']): void {
  db.prepare(`UPDATE reminders SET status = ? WHERE id = ?`).run(status, id);
}
