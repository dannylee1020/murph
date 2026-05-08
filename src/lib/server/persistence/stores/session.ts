import { randomUUID } from 'node:crypto';
import type { AutopilotSession, SessionContextSnapshot, SessionMode, SessionStatus, UserPolicyProfile } from '#lib/types';
import type { Db } from './_shared.js';
import { parseJsonArray, parseJsonObject } from './_shared.js';

export interface SessionInput {
  workspaceId: string;
  ownerUserId?: string;
  ownerSlackUserId?: string;
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
  owner_user_id?: string;
  title: string;
  mode: SessionMode;
  status: SessionStatus;
  channel_scope_json: string;
  policy_profile_name?: string;
  policy_override_raw?: string;
  policy_json?: string;
  session_context_json?: string;
  started_at: string;
  ends_at: string;
  stopped_at?: string;
}

const emptySessionContext: SessionContextSnapshot = {
  builtAt: new Date(0).toISOString(),
  date: '1970-01-01',
  sections: [],
  summary: ''
};

function mapSession(row: SessionRow): AutopilotSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id ?? row.owner_slack_user_id,
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
    contextSnapshot: row.session_context_json
      ? parseJsonObject<SessionContextSnapshot>(row.session_context_json, emptySessionContext)
      : undefined,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    stoppedAt: row.stopped_at
  };
}

export function createSession(db: Db, input: SessionInput): AutopilotSession {
  const ownerUserId = input.ownerUserId ?? input.ownerSlackUserId;
  if (!ownerUserId) {
    throw new Error('ownerUserId is required');
  }
  const session: AutopilotSession = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    ownerUserId,
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
      id, workspace_id, owner_slack_user_id, owner_user_id, title, mode, status, channel_scope_json,
      policy_profile_name, policy_override_raw, policy_json, session_context_json, started_at, ends_at, stopped_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    session.id,
    session.workspaceId,
    session.ownerUserId,
    session.ownerUserId,
    session.title,
    session.mode,
    session.status,
    JSON.stringify(session.channelScope),
    session.policyProfileName ?? null,
    session.policyOverrideRaw ?? null,
    session.policy ? JSON.stringify(session.policy) : null,
    null,
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
              owner_user_id,
              policy_profile_name, policy_override_raw, policy_json, session_context_json, started_at, ends_at, stopped_at
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

export function getSessionContext(db: Db, id: string): SessionContextSnapshot | undefined {
  const row = db
    .prepare(`SELECT session_context_json FROM autopilot_sessions WHERE id = ?`)
    .get(id) as { session_context_json?: string } | undefined;
  return row?.session_context_json
    ? parseJsonObject<SessionContextSnapshot>(row.session_context_json, emptySessionContext)
    : undefined;
}

export function setSessionContext(db: Db, id: string, context: SessionContextSnapshot): AutopilotSession | undefined {
  db.prepare(`UPDATE autopilot_sessions SET session_context_json = ? WHERE id = ?`).run(
    JSON.stringify(context),
    id
  );
  return getSessionById(db, id);
}

export function listCompletedSessions(db: Db, workspaceId?: string, limit = 20): AutopilotSession[] {
  const rows = db
    .prepare(
      workspaceId
        ? `SELECT * FROM autopilot_sessions
           WHERE workspace_id = ? AND status IN ('stopped', 'expired')
           ORDER BY COALESCE(stopped_at, ends_at) DESC
           LIMIT ?`
        : `SELECT * FROM autopilot_sessions
           WHERE status IN ('stopped', 'expired')
           ORDER BY COALESCE(stopped_at, ends_at) DESC
           LIMIT ?`
    )
    .all(...(workspaceId ? [workspaceId, limit] : [limit])) as SessionRow[];
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
  ownerUserId: string,
  channelId: string
): AutopilotSession | undefined {
  const sessions = listActiveSessions(db, workspaceId).filter(
    (session) =>
      session.ownerUserId === ownerUserId &&
      (session.channelScope.length === 0 || session.channelScope.includes(channelId))
  );

  return sessions[0];
}
