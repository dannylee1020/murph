import { randomUUID } from 'node:crypto';
import type {
  AgentUser,
  ChannelProvider,
  PolicyExecutionMode,
  UserSchedule,
  WorkspaceSubscription,
  WorkspaceSubscriptionChannelScopeMode,
  WorkspaceSubscriptionStatus
} from '#shared/types';
import type { Db } from './_shared.js';
import { parseJsonArray } from './_shared.js';

export interface WorkspaceSubscriptionInput {
  workspaceId: string;
  provider: ChannelProvider;
  externalUserId: string;
  displayName: string;
  status?: WorkspaceSubscriptionStatus;
  channelScopeMode?: WorkspaceSubscriptionChannelScopeMode;
  channelScope?: string[];
  schedule?: Partial<UserSchedule>;
  policyProfileName?: string | null;
  policyMode?: PolicyExecutionMode | null;
  dashboardTokenHash?: string;
}

interface WorkspaceSubscriptionRow {
  id: string;
  workspace_id: string;
  provider: ChannelProvider;
  external_user_id: string;
  display_name: string;
  status: WorkspaceSubscriptionStatus;
  channel_scope_mode: WorkspaceSubscriptionChannelScopeMode;
  channel_scope_json: string;
  timezone?: string;
  workday_start_hour?: number;
  workday_end_hour?: number;
  policy_profile_name?: string;
  policy_mode?: PolicyExecutionMode;
  dashboard_token_hash?: string;
  created_at: string;
  updated_at: string;
}

function scheduleFromRow(row: WorkspaceSubscriptionRow): UserSchedule | undefined {
  if (!row.timezone || row.workday_start_hour === undefined || row.workday_end_hour === undefined) {
    return undefined;
  }
  return {
    timezone: row.timezone,
    workdayStartHour: row.workday_start_hour,
    workdayEndHour: row.workday_end_hour
  };
}

function mapSubscription(row: WorkspaceSubscriptionRow): WorkspaceSubscription {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    externalUserId: row.external_user_id,
    displayName: row.display_name,
    status: row.status,
    channelScopeMode: row.channel_scope_mode,
    channelScope: parseJsonArray(row.channel_scope_json),
    schedule: scheduleFromRow(row),
    policyProfileName: row.policy_profile_name ?? undefined,
    policyMode: row.policy_mode ?? undefined,
    dashboardTokenHash: row.dashboard_token_hash ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeChannelScope(
  mode: WorkspaceSubscriptionChannelScopeMode,
  channelScope: string[]
): string[] {
  if (mode === 'all_accessible') {
    return [];
  }

  const scoped = [...new Set(channelScope.map((channelId) => channelId.trim()).filter(Boolean))];
  if (scoped.length === 0) {
    throw new Error('selected channel scope requires at least one channel');
  }
  return scoped;
}

export function upsertWorkspaceSubscription(db: Db, input: WorkspaceSubscriptionInput): WorkspaceSubscription {
  if (!input.externalUserId) {
    throw new Error('externalUserId is required');
  }

  const existing = getWorkspaceSubscription(db, input.workspaceId, input.externalUserId);
  const now = new Date().toISOString();
  const id = existing?.id ?? randomUUID();
  const schedule = input.schedule ?? existing?.schedule;
  const channelScopeMode = input.channelScopeMode ?? existing?.channelScopeMode ?? 'all_accessible';
  const channelScope = normalizeChannelScope(channelScopeMode, input.channelScope ?? existing?.channelScope ?? []);

  db.prepare(
    `INSERT INTO workspace_subscriptions (
      id, workspace_id, provider, external_user_id, display_name, status,
      channel_scope_mode, channel_scope_json, timezone, workday_start_hour,
      workday_end_hour, policy_profile_name, policy_mode, dashboard_token_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, external_user_id) DO UPDATE SET
      provider = excluded.provider,
      display_name = excluded.display_name,
      status = excluded.status,
      channel_scope_mode = excluded.channel_scope_mode,
      channel_scope_json = excluded.channel_scope_json,
      timezone = excluded.timezone,
      workday_start_hour = excluded.workday_start_hour,
      workday_end_hour = excluded.workday_end_hour,
      policy_profile_name = excluded.policy_profile_name,
      policy_mode = excluded.policy_mode,
      dashboard_token_hash = excluded.dashboard_token_hash,
      updated_at = excluded.updated_at`
  ).run(
    id,
    input.workspaceId,
    input.provider,
    input.externalUserId,
    input.displayName,
    input.status ?? existing?.status ?? 'active',
    channelScopeMode,
    JSON.stringify(channelScope),
    schedule?.timezone ?? null,
    schedule?.workdayStartHour ?? null,
    schedule?.workdayEndHour ?? null,
    input.policyProfileName !== undefined ? input.policyProfileName : existing?.policyProfileName ?? null,
    input.policyMode !== undefined ? input.policyMode : existing?.policyMode ?? null,
    input.dashboardTokenHash ?? existing?.dashboardTokenHash ?? null,
    existing?.createdAt ?? now,
    now
  );

  return getWorkspaceSubscription(db, input.workspaceId, input.externalUserId)!;
}

export function ensureWorkspaceSubscriptionForUser(
  db: Db,
  user: AgentUser,
  input: Omit<WorkspaceSubscriptionInput, 'workspaceId' | 'externalUserId' | 'displayName' | 'schedule'>
): WorkspaceSubscription {
  return upsertWorkspaceSubscription(db, {
    ...input,
    workspaceId: user.workspaceId,
    externalUserId: user.externalUserId,
    displayName: user.displayName,
    schedule: user.schedule
  });
}

export function getWorkspaceSubscription(
  db: Db,
  workspaceId: string,
  externalUserId: string
): WorkspaceSubscription | undefined {
  const row = db
    .prepare(`SELECT * FROM workspace_subscriptions WHERE workspace_id = ? AND external_user_id = ?`)
    .get(workspaceId, externalUserId) as WorkspaceSubscriptionRow | undefined;
  return row ? mapSubscription(row) : undefined;
}

export function listWorkspaceSubscriptions(
  db: Db,
  workspaceId?: string,
  status?: WorkspaceSubscriptionStatus
): WorkspaceSubscription[] {
  const filters = [
    ...(workspaceId ? ['workspace_id = ?'] : []),
    ...(status ? ['status = ?'] : [])
  ];
  const sql = `SELECT * FROM workspace_subscriptions${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} ORDER BY display_name`;
  const rows = db.prepare(sql).all(...[workspaceId, status].filter((value): value is string => Boolean(value))) as WorkspaceSubscriptionRow[];
  return rows.map(mapSubscription);
}

export function subscriptionAllowsChannel(
  subscription: WorkspaceSubscription,
  channelId: string
): boolean {
  return subscription.channelScopeMode === 'all_accessible' || subscription.channelScope.includes(channelId);
}

export function subscriptionAllowsChannelScope(
  subscription: WorkspaceSubscription,
  channelScope: string[]
): boolean {
  if (subscription.channelScopeMode === 'all_accessible') {
    return true;
  }
  if (subscription.channelScope.length === 0 || channelScope.length === 0) {
    return false;
  }
  return channelScope.every((channelId) => subscription.channelScope.includes(channelId));
}

export function listActiveWorkspaceSubscriptionsForChannel(
  db: Db,
  workspaceId: string,
  channelId: string
): WorkspaceSubscription[] {
  return listWorkspaceSubscriptions(db, workspaceId, 'active').filter((subscription) =>
    subscriptionAllowsChannel(subscription, channelId)
  );
}
