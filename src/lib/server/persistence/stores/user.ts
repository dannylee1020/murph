import { randomUUID } from 'node:crypto';
import type { AgentUser } from '#lib/types';
import type { Db } from './_shared.js';

export interface UpsertUserInput {
  workspaceId: string;
  slackUserId: string;
  displayName: string;
  fallbackSlackUserId?: string;
  timezone?: string;
  workdayStartHour?: number;
  workdayEndHour?: number;
}

interface UserRow {
  id: string;
  workspace_id: string;
  slack_user_id: string;
  display_name: string;
  fallback_slack_user_id?: string;
  timezone: string;
  workday_start_hour: number;
  workday_end_hour: number;
}

function mapUser(row: UserRow): AgentUser {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slackUserId: row.slack_user_id,
    displayName: row.display_name,
    fallbackSlackUserId: row.fallback_slack_user_id,
    schedule: {
      timezone: row.timezone,
      workdayStartHour: row.workday_start_hour,
      workdayEndHour: row.workday_end_hour
    }
  };
}

export function upsertUser(db: Db, input: UpsertUserInput): AgentUser {
  const existing = db
    .prepare(`SELECT id FROM users WHERE workspace_id = ? AND slack_user_id = ?`)
    .get(input.workspaceId, input.slackUserId) as { id: string } | undefined;

  const id = existing?.id ?? randomUUID();

  db.prepare(
    `INSERT INTO users (
      id, workspace_id, slack_user_id, display_name, fallback_slack_user_id,
      timezone, workday_start_hour, workday_end_hour
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, slack_user_id) DO UPDATE SET
      display_name = excluded.display_name,
      fallback_slack_user_id = excluded.fallback_slack_user_id,
      timezone = excluded.timezone,
      workday_start_hour = excluded.workday_start_hour,
      workday_end_hour = excluded.workday_end_hour`
  ).run(
    id,
    input.workspaceId,
    input.slackUserId,
    input.displayName,
    input.fallbackSlackUserId ?? null,
    input.timezone ?? 'America/Los_Angeles',
    input.workdayStartHour ?? 9,
    input.workdayEndHour ?? 17
  );

  return getUser(db, input.workspaceId, input.slackUserId)!;
}

export function getUser(db: Db, workspaceId: string, slackUserId: string): AgentUser | undefined {
  const row = db
    .prepare(
      `SELECT id, workspace_id, slack_user_id, display_name, fallback_slack_user_id,
              timezone, workday_start_hour, workday_end_hour
       FROM users WHERE workspace_id = ? AND slack_user_id = ?`
    )
    .get(workspaceId, slackUserId) as UserRow | undefined;
  return row ? mapUser(row) : undefined;
}

export function listUsers(db: Db, workspaceId?: string): AgentUser[] {
  const rows = db
    .prepare(
      workspaceId
        ? `SELECT * FROM users WHERE workspace_id = ? ORDER BY display_name`
        : `SELECT * FROM users ORDER BY display_name`
    )
    .all(...(workspaceId ? [workspaceId] : [])) as UserRow[];

  return rows.map(mapUser);
}
