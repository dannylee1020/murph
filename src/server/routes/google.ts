import type { IncomingMessage } from 'node:http';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getStore } from '#lib/server/persistence/store';
import { getIntegration } from '#lib/server/integrations/registry';
import {
  isGoogleOAuthConfigured,
  buildGoogleInstallUrl,
  exchangeGoogleCode,
  revokeGoogleToken
} from '#lib/server/integrations/google-oauth';
import {
  enableIntegrationCapabilities,
  disableIntegrationCapabilities
} from '#lib/server/integrations/capabilities';
import { redirect, sendJson } from '../http.js';
import { route, type Route } from '../router.js';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function publicAppUrl(req: IncomingMessage, url: URL): string {
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const host = forwardedHost ?? req.headers.host ?? url.host;
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const proto = forwardedProto ?? (host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function getTargetWorkspace(workspaceId?: string) {
  const store = getStore();
  return workspaceId ? store.getWorkspaceById(workspaceId) : store.getFirstWorkspace();
}

export const googleRoutes: Route[] = [
  route('GET', '/api/google/install', ({ req, res, url }) => {
    if (!isGoogleOAuthConfigured()) {
      redirect(res, '/settings?error=google_not_configured');
      return;
    }

    const workspace = getTargetWorkspace(url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      redirect(res, '/settings?error=workspace_required');
      return;
    }

    const base = publicAppUrl(req, url);
    const redirectUri = `${base}/api/google/oauth/callback`;
    const installUrl = buildGoogleInstallUrl(redirectUri, workspace.id);
    redirect(res, installUrl);
  }),
  route('GET', '/api/google/oauth/callback', async ({ req, res, url }) => {
    const code = url.searchParams.get('code');
    const workspaceId = url.searchParams.get('state');

    if (!code) {
      redirect(res, '/settings?error=missing_code');
      return;
    }

    const workspace = getTargetWorkspace(workspaceId ?? undefined);
    if (!workspace) {
      redirect(res, '/settings?error=workspace_required');
      return;
    }

    const encryptionKey = getRuntimeEnv().encryptionKey;
    if (!encryptionKey) {
      redirect(res, '/settings?error=encryption_key_required');
      return;
    }

    try {
      const base = publicAppUrl(req, url);
      const redirectUri = `${base}/api/google/oauth/callback`;
      await exchangeGoogleCode(code, redirectUri, workspace.id);

      const definition = getIntegration('google')!;
      enableIntegrationCapabilities(workspace.id, definition);
      redirect(res, '/settings?google=connected');
    } catch (error) {
      console.error('[google] OAuth callback failed:', error);
      redirect(res, `/settings?error=${encodeURIComponent(error instanceof Error ? error.message : 'google_oauth_failed')}`);
    }
  }),
  route('DELETE', '/api/google/disconnect', async ({ res, url }) => {
    const workspace = getTargetWorkspace(url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }

    await revokeGoogleToken(workspace.id);
    const store = getStore();
    store.deleteIntegrationCredential(workspace.id, 'google');
    const definition = getIntegration('google')!;
    disableIntegrationCapabilities(workspace.id, definition);
    sendJson(res, { ok: true });
  })
];
