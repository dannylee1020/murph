import { randomUUID } from 'node:crypto';
import type { AgentUser } from '#lib/types';
import type { Db } from './_shared.js';

export interface UpsertUserInput {
  workspaceId: string;
  externalUserId: string;
  displayName: string;
  fallbackExternalUserId?: string;
  timezone?: string;
  workdayStartHour?: number;
  workdayEndHour?: number;
}

interface UserRow {
  id: string;
  workspace_id: string;
  external_user_id: string;
  display_name: string;
  fallback_external_user_id?: string;
  timezone: string;
  workday_start_hour: number;
  workday_end_hour: number;
}

function mapUser(row: UserRow): AgentUser {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    externalUserId: row.external_user_id,
    displayName: row.display_name,
    fallbackExternalUserId: row.fallback_external_user_id,
    schedule: {
      timezone: row.timezone,
      workdayStartHour: row.workday_start_hour,
      workdayEndHour: row.workday_end_hour
    }
  };
}

export function upsertUser(db: Db, input: UpsertUserInput): AgentUser {
  const externalUserId = input.externalUserId;
  if (!externalUserId) {
    throw new Error('externalUserId is required');
  }
  const existing = getUser(db, input.workspaceId, externalUserId);

  const id = existing?.id ?? randomUUID();
  const timezone = input.timezone ?? existing?.schedule.timezone ?? 'America/Los_Angeles';
  const workdayStartHour = input.workdayStartHour ?? existing?.schedule.workdayStartHour ?? 9;
  const workdayEndHour = input.workdayEndHour ?? existing?.schedule.workdayEndHour ?? 17;

  db.prepare(
    `INSERT INTO users (
      id, workspace_id, external_user_id, display_name, fallback_external_user_id,
      timezone, workday_start_hour, workday_end_hour
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, external_user_id) DO UPDATE SET
      display_name = excluded.display_name,
      fallback_external_user_id = excluded.fallback_external_user_id,
      timezone = excluded.timezone,
      workday_start_hour = excluded.workday_start_hour,
      workday_end_hour = excluded.workday_end_hour`
  ).run(
    id,
    input.workspaceId,
    externalUserId,
    input.displayName,
    input.fallbackExternalUserId ?? existing?.fallbackExternalUserId ?? null,
    timezone,
    workdayStartHour,
    workdayEndHour
  );

  return getUser(db, input.workspaceId, externalUserId)!;
}

export function getUser(db: Db, workspaceId: string, userId: string): AgentUser | undefined {
  const row = db
    .prepare(
      `SELECT id, workspace_id, external_user_id, display_name, fallback_external_user_id,
              timezone, workday_start_hour, workday_end_hour
       FROM users WHERE workspace_id = ? AND external_user_id = ?`
    )
    .get(workspaceId, userId) as UserRow | undefined;
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
