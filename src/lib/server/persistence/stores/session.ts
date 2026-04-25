import { randomUUID } from 'node:crypto';
import type { AutopilotSession, SessionMode, SessionStatus, UserPolicyProfile } from '#lib/types';
import type { Db } from './_shared.js';
import { parseJsonArray, parseJsonObject } from './_shared.js';

export interface SessionInput {
  workspaceId: string;
  ownerSlackUserId: string;
  title: string;
  mode: SessionMode;
  channelScope: string[];
  policyProfileName?: string;
  policyOverrideRaw?: string;
  policy?: UserPolicyProfile;
  endsAt: string;
}

interface SessionRow {
  id: string;
  workspace_id: string;
  owner_slack_user_id: string;
  title: string;
  mode: SessionMode;
  status: SessionStatus;
  channel_scope_json: string;
  policy_profile_name?: string;
  policy_override_raw?: string;
  policy_json?: string;
  started_at: string;
  ends_at: string;
  stopped_at?: string;
}

function mapSession(row: SessionRow): AutopilotSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerSlackUserId: row.owner_slack_user_id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    channelScope: parseJsonArray(row.channel_scope_json),
    policyProfileName: row.policy_profile_name,
    policyOverrideRaw: row.policy_override_raw,
    policy: row.policy_json
      ? parseJsonObject<UserPolicyProfile>(row.policy_json, {
          raw: '',
          compiled: {
            blockedTopics: [],
            alwaysQueueTopics: [],
            blockedActions: [],
            requireGroundingForFacts: true,
            preferAskWhenUncertain: true,
            allowAutoSend: false,
            notesForAgent: []
          },
          compiledAt: new Date(0).toISOString(),
          source: 'default',
          version: 1
        })
      : undefined,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    stoppedAt: row.stopped_at
  };
}

export function createSession(db: Db, input: SessionInput): AutopilotSession {
  const session: AutopilotSession = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    ownerSlackUserId: input.ownerSlackUserId,
    title: input.title,
    mode: input.mode,
    status: 'active',
    channelScope: input.channelScope,
    policyProfileName: input.policyProfileName,
    policyOverrideRaw: input.policyOverrideRaw,
    policy: input.policy,
    startedAt: new Date().toISOString(),
    endsAt: input.endsAt
  };

  db.prepare(
    `INSERT INTO autopilot_sessions (
      id, workspace_id, owner_slack_user_id, title, mode, status, channel_scope_json,
      policy_profile_name, policy_override_raw, policy_json, started_at, ends_at, stopped_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    session.id,
    session.workspaceId,
    session.ownerSlackUserId,
    session.title,
    session.mode,
    session.status,
    JSON.stringify(session.channelScope),
    session.policyProfileName ?? null,
    session.policyOverrideRaw ?? null,
    session.policy ? JSON.stringify(session.policy) : null,
    session.startedAt,
    session.endsAt,
    null
  );

  return session;
}

export function getSessionById(db: Db, id: string): AutopilotSession | undefined {
  const row = db
    .prepare(
      `SELECT id, workspace_id, owner_slack_user_id, title, mode, status, channel_scope_json,
              policy_profile_name, policy_override_raw, policy_json, started_at, ends_at, stopped_at
       FROM autopilot_sessions WHERE id = ?`
    )
    .get(id) as SessionRow | undefined;
  return row ? mapSession(row) : undefined;
}

export function listActiveSessions(db: Db, workspaceId?: string): AutopilotSession[] {
  const rows = db
    .prepare(
      workspaceId
        ? `SELECT * FROM autopilot_sessions WHERE workspace_id = ? AND status = 'active' ORDER BY started_at DESC`
        : `SELECT * FROM autopilot_sessions WHERE status = 'active' ORDER BY started_at DESC`
    )
    .all(...(workspaceId ? [workspaceId] : [])) as SessionRow[];
  return rows.map(mapSession);
}

export function stopSession(db: Db, id: string, status: SessionStatus = 'stopped'): void {
  db.prepare(`UPDATE autopilot_sessions SET status = ?, stopped_at = ? WHERE id = ?`).run(
    status,
    new Date().toISOString(),
    id
  );
}

export function expireDueSessions(db: Db, nowIso: string): void {
  db.prepare(
    `UPDATE autopilot_sessions
     SET status = 'expired', stopped_at = COALESCE(stopped_at, ?)
     WHERE status = 'active' AND ends_at <= ?`
  ).run(nowIso, nowIso);
}

export function findMatchingSession(
  db: Db,
  workspaceId: string,
  ownerSlackUserId: string,
  channelId: string
): AutopilotSession | undefined {
  const sessions = listActiveSessions(db, workspaceId).filter(
    (session) =>
      session.ownerSlackUserId === ownerSlackUserId &&
      (session.channelScope.length === 0 || session.channelScope.includes(channelId))
  );

  return sessions[0];
}
