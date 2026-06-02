import { randomUUID } from 'node:crypto';
import type {
  AutopilotSession,
  SessionChannelScopeBinding,
  SessionMode,
  SessionPolicyBinding,
  SessionStatus,
  UserPolicyProfile
} from '#shared/types';
import { normalizeCompiledPolicy } from '#shared/server/runtime/policy-compiler';
import type { Db } from './_shared.js';
import { parseJsonArray, parseJsonObject } from './_shared.js';

export interface SessionInput {
  workspaceId: string;
  ownerUserId?: string;
  title: string;
  mode: SessionMode;
  channelScope: string[];
  policyProfileName?: string;
  policyOverrideRaw?: string;
  policy?: UserPolicyProfile;
  runtimeRevisionJson?: string;
  lastRuntimeRefreshAt?: string;
  policyBinding?: SessionPolicyBinding;
  channelScopeBinding?: SessionChannelScopeBinding;
  endsAt: string;
}

interface SessionRow {
  id: string;
  workspace_id: string;
  owner_user_id?: string | null;
  title: string;
  mode: SessionMode;
  status: SessionStatus;
  channel_scope_json: string;
  policy_profile_name?: string;
  policy_override_raw?: string;
  policy_json?: string;
  runtime_revision_json?: string;
  last_runtime_refresh_at?: string;
  policy_binding?: SessionPolicyBinding;
  channel_scope_binding?: SessionChannelScopeBinding;
  started_at: string;
  ends_at: string;
  stopped_at?: string;
}

export interface SessionRefreshPatch {
  mode?: SessionMode;
  channelScope?: string[];
  policyProfileName?: string;
  policyOverrideRaw?: string;
  policy?: UserPolicyProfile;
  runtimeRevisionJson: string;
  lastRuntimeRefreshAt: string;
}

function mapSession(row: SessionRow): AutopilotSession {
  const policy = row.policy_json
    ? parseJsonObject<UserPolicyProfile>(row.policy_json, {
        raw: '',
        compiled: {
          blockedTopics: [],
          alwaysQueueTopics: [],
          blockedActions: [],
          executionMode: 'manual_review',
          requireGroundingForFacts: true,
          preferAskWhenUncertain: true,
          allowAutoSend: false,
          notesForAgent: []
        },
        compiledAt: new Date(0).toISOString(),
        source: 'default',
        version: 1
      })
    : undefined;

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id ?? undefined,
    title: row.title,
    mode: row.mode,
    status: row.status,
    channelScope: parseJsonArray(row.channel_scope_json),
    policyProfileName: row.policy_profile_name ?? undefined,
    policyOverrideRaw: row.policy_override_raw ?? undefined,
    policy: policy ? { ...policy, compiled: normalizeCompiledPolicy(policy.compiled) } : undefined,
    runtimeRevisionJson: row.runtime_revision_json ?? undefined,
    lastRuntimeRefreshAt: row.last_runtime_refresh_at ?? undefined,
    policyBinding: row.policy_binding ?? 'config',
    channelScopeBinding: row.channel_scope_binding ?? 'setup_defaults',
    startedAt: row.started_at,
    endsAt: row.ends_at,
    stoppedAt: row.stopped_at
  };
}

export function createSession(db: Db, input: SessionInput): AutopilotSession {
  const session: AutopilotSession = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    title: input.title,
    mode: input.mode,
    status: 'active',
    channelScope: input.channelScope,
    policyProfileName: input.policyProfileName,
    policyOverrideRaw: input.policyOverrideRaw,
    policy: input.policy,
    runtimeRevisionJson: input.runtimeRevisionJson,
    lastRuntimeRefreshAt: input.lastRuntimeRefreshAt,
    policyBinding: input.policyBinding ?? 'explicit',
    channelScopeBinding: input.channelScopeBinding ?? 'explicit',
    startedAt: new Date().toISOString(),
    endsAt: input.endsAt
  };

  db.prepare(
    `INSERT INTO autopilot_sessions (
      id, workspace_id, owner_user_id, title, mode, status, channel_scope_json,
      policy_profile_name, policy_override_raw, policy_json, runtime_revision_json,
      last_runtime_refresh_at, policy_binding, channel_scope_binding, started_at, ends_at, stopped_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    session.id,
    session.workspaceId,
    session.ownerUserId ?? null,
    session.title,
    session.mode,
    session.status,
    JSON.stringify(session.channelScope),
    session.policyProfileName ?? null,
    session.policyOverrideRaw ?? null,
    session.policy ? JSON.stringify(session.policy) : null,
    session.runtimeRevisionJson ?? null,
    session.lastRuntimeRefreshAt ?? null,
    session.policyBinding,
    session.channelScopeBinding,
    session.startedAt,
    session.endsAt,
    null
  );

  return session;
}

export function getSessionById(db: Db, id: string): AutopilotSession | undefined {
  const row = db
    .prepare(
      `SELECT id, workspace_id, owner_user_id, title, mode, status, channel_scope_json,
              policy_profile_name, policy_override_raw, policy_json, runtime_revision_json,
              last_runtime_refresh_at, policy_binding, channel_scope_binding, started_at, ends_at, stopped_at
       FROM autopilot_sessions WHERE id = ?`
    )
    .get(id) as SessionRow | undefined;
  return row ? mapSession(row) : undefined;
}

export function patchSessionRefresh(db: Db, id: string, patch: SessionRefreshPatch): AutopilotSession | undefined {
  const existing = getSessionById(db, id);
  if (!existing) {
    return undefined;
  }

  db.prepare(
    `UPDATE autopilot_sessions
     SET mode = ?,
         channel_scope_json = ?,
         policy_profile_name = ?,
         policy_override_raw = ?,
         policy_json = ?,
         runtime_revision_json = ?,
         last_runtime_refresh_at = ?
     WHERE id = ?`
  ).run(
    patch.mode ?? existing.mode,
    JSON.stringify(patch.channelScope ?? existing.channelScope),
    Object.prototype.hasOwnProperty.call(patch, 'policyProfileName')
      ? patch.policyProfileName ?? null
      : existing.policyProfileName ?? null,
    Object.prototype.hasOwnProperty.call(patch, 'policyOverrideRaw')
      ? patch.policyOverrideRaw ?? null
      : existing.policyOverrideRaw ?? null,
    Object.prototype.hasOwnProperty.call(patch, 'policy')
      ? patch.policy ? JSON.stringify(patch.policy) : null
      : existing.policy ? JSON.stringify(existing.policy) : null,
    patch.runtimeRevisionJson,
    patch.lastRuntimeRefreshAt,
    id
  );

  return getSessionById(db, id);
}

export function listActiveSessions(db: Db, workspaceId?: string, ownerUserId?: string): AutopilotSession[] {
  const nowIso = new Date().toISOString();
  const where = [`status = 'active'`, `ends_at > ?`];
  const args: Array<string | number> = [nowIso];
  if (workspaceId) {
    where.unshift(`workspace_id = ?`);
    args.unshift(workspaceId);
  }
  if (ownerUserId) {
    where.push(`owner_user_id = ?`);
    args.push(ownerUserId);
  }
  const rows = db
    .prepare(
      `SELECT * FROM autopilot_sessions
       WHERE ${where.join(' AND ')}
       ORDER BY started_at DESC`
    )
    .all(...args) as SessionRow[];
  return rows.map(mapSession);
}

export function listCompletedSessions(db: Db, workspaceId?: string, limit = 20, ownerUserId?: string): AutopilotSession[] {
  const where = [`status IN ('stopped', 'expired')`];
  const args: Array<string | number> = [];
  if (workspaceId) {
    where.push(`workspace_id = ?`);
    args.push(workspaceId);
  }
  if (ownerUserId) {
    where.push(`owner_user_id = ?`);
    args.push(ownerUserId);
  }
  args.push(limit);
  const rows = db
    .prepare(
      `SELECT * FROM autopilot_sessions
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(stopped_at, ends_at) DESC
       LIMIT ?`
    )
    .all(...args) as SessionRow[];
  return rows.map(mapSession);
}

export function stopSession(db: Db, id: string, status: SessionStatus = 'stopped'): void {
  db.prepare(`UPDATE autopilot_sessions SET status = ?, stopped_at = ? WHERE id = ?`).run(
    status,
    new Date().toISOString(),
    id
  );
}

export function expireDueSessions(db: Db, nowIso: string): AutopilotSession[] {
  const due = db
    .prepare(`SELECT * FROM autopilot_sessions WHERE status = 'active' AND ends_at <= ? ORDER BY ends_at ASC`)
    .all(nowIso) as SessionRow[];
  db.prepare(
    `UPDATE autopilot_sessions
     SET status = 'expired', stopped_at = COALESCE(stopped_at, ?)
     WHERE status = 'active' AND ends_at <= ?`
  ).run(nowIso, nowIso);
  return due.map((row) => ({
    ...mapSession(row),
    status: 'expired' as const,
    stoppedAt: row.stopped_at ?? nowIso
  }));
}

export function findMatchingSession(
  db: Db,
  workspaceId: string,
  ownerUserId: string | undefined,
  channelId: string
): AutopilotSession | undefined {
  const sessions = listActiveSessions(db, workspaceId).filter(
    (session) =>
      (ownerUserId ? session.ownerUserId === ownerUserId : !session.ownerUserId) &&
      (session.channelScope.length === 0 || session.channelScope.includes(channelId))
  );

  return sessions[0];
}
