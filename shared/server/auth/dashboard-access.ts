import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getStore } from '#shared/server/persistence/store';
import { readMurphConfig } from '#shared/server/setup/config-file';
import { sendJson } from '#shared/server/http';
import type { WorkspaceSubscription } from '#shared/types';

const DASHBOARD_TOKEN_BYTES = 32;

export function generateDashboardToken(): string {
  return `mph_${randomBytes(DASHBOARD_TOKEN_BYTES).toString('base64url')}`;
}

export function hashDashboardToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return match?.[1]?.trim() || undefined;
}

export function resolvePublicAppUrl(req?: IncomingMessage, url?: URL): string {
  const hostHeader = req
    ? Array.isArray(req.headers['x-forwarded-host'])
      ? req.headers['x-forwarded-host'][0]
      : req.headers['x-forwarded-host'] ?? req.headers.host
    : undefined;
  const host = hostHeader ?? url?.host;
  const protoHeader = req
    ? Array.isArray(req.headers['x-forwarded-proto'])
      ? req.headers['x-forwarded-proto'][0]
      : req.headers['x-forwarded-proto']
    : undefined;
  const configured = readMurphConfig().app?.url ?? process.env.MURPH_APP_URL;
  if (!host && configured) {
    return configured.replace(/\/+$/, '');
  }

  const resolvedHost = host ?? `localhost:${process.env.PORT ?? process.env.MURPH_PORT ?? '5173'}`;
  const proto = protoHeader ?? (resolvedHost.includes('localhost') || resolvedHost.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${resolvedHost}`.replace(/\/+$/, '');
}

export function subscriberDashboardUrl(baseUrl: string, token: string): string {
  const url = new URL('/me', baseUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

export function issueSubscriberDashboardToken(
  workspaceId: string,
  externalUserId: string,
  baseUrl: string
): { token: string; url: string; subscription: WorkspaceSubscription } {
  const store = getStore();
  const existing = store.getWorkspaceSubscription(workspaceId, externalUserId);
  if (!existing) {
    throw new Error('subscription_not_found');
  }

  const token = generateDashboardToken();
  const subscription = store.upsertWorkspaceSubscription({
    workspaceId: existing.workspaceId,
    provider: existing.provider,
    externalUserId: existing.externalUserId,
    displayName: existing.displayName,
    status: existing.status,
    channelScopeMode: existing.channelScopeMode,
    channelScope: existing.channelScope,
    schedule: existing.schedule,
    policyProfileName: existing.policyProfileName,
    policyMode: existing.policyMode,
    dashboardTokenHash: hashDashboardToken(token)
  });

  return {
    token,
    url: subscriberDashboardUrl(baseUrl, token),
    subscription
  };
}

export function revokeSubscriberDashboardToken(
  workspaceId: string,
  externalUserId: string
): WorkspaceSubscription {
  const store = getStore();
  const existing = store.getWorkspaceSubscription(workspaceId, externalUserId);
  if (!existing) {
    throw new Error('subscription_not_found');
  }
  return store.upsertWorkspaceSubscription({
    workspaceId: existing.workspaceId,
    provider: existing.provider,
    externalUserId: existing.externalUserId,
    displayName: existing.displayName,
    status: existing.status,
    channelScopeMode: existing.channelScopeMode,
    channelScope: existing.channelScope,
    schedule: existing.schedule,
    policyProfileName: existing.policyProfileName,
    policyMode: existing.policyMode,
    dashboardTokenHash: ''
  });
}

export function authenticateSubscriberDashboardRequest(req: IncomingMessage): WorkspaceSubscription | undefined {
  const token = bearerToken(req);
  if (!token) {
    return undefined;
  }

  const hashed = hashDashboardToken(token);
  return getStore()
    .listWorkspaceSubscriptions()
    .find((candidate) => candidate.dashboardTokenHash && safeEqual(candidate.dashboardTokenHash, hashed));
}

export function requireSubscriberDashboard(
  req: IncomingMessage,
  res: ServerResponse
): WorkspaceSubscription | undefined {
  const subscription = authenticateSubscriberDashboardRequest(req);
  if (subscription) {
    return subscription;
  }
  sendJson(res, { ok: false, error: 'subscriber_token_required' }, 401);
  return undefined;
}
