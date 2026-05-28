import type { IncomingMessage } from 'node:http';
import { getStore } from '#shared/server/persistence/store';
import { getSlackService } from '#shared/server/channels/slack/service';
import { getIntegration } from '#shared/server/integrations/registry';
import {
  isGoogleOAuthConfigured,
  buildGoogleInstallUrl,
  exchangeGoogleCode,
  revokeGoogleToken
} from '#shared/server/integrations/google-oauth';
import {
  enableIntegrationCapabilitiesForAllWorkspaces,
  disableIntegrationCapabilitiesForAllWorkspaces
} from '#shared/server/integrations/capabilities';
import { refreshRuntimeState } from '#shared/server/runtime/refresh';
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
  if (workspaceId) {
    return store.getWorkspaceById(workspaceId);
  }

  return getSlackService().getUsableWorkspace() ??
    store.getFirstWorkspace();
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
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      redirect(res, `/settings?error=${encodeURIComponent(url.searchParams.get('error_description') ?? oauthError)}`);
      return;
    }

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

    try {
      const base = publicAppUrl(req, url);
      const redirectUri = `${base}/api/google/oauth/callback`;
      await exchangeGoogleCode(code, redirectUri, workspace.id);

      const definition = getIntegration('google')!;
      enableIntegrationCapabilitiesForAllWorkspaces(definition);
      await refreshRuntimeState({
        reason: 'integration_updated',
        workspaceIds: [workspace.id],
        deferIfRunActive: true
      });
      redirect(res, `/settings?google=connected&workspaceId=${encodeURIComponent(workspace.id)}`);
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
    const definition = getIntegration('google')!;
    for (const installedWorkspace of store.listWorkspaces()) {
      store.deleteIntegrationConnection(installedWorkspace.id, 'google');
    }
    disableIntegrationCapabilitiesForAllWorkspaces(definition);
    const refresh = await refreshRuntimeState({
      reason: 'integration_updated',
      workspaceIds: [workspace.id],
      deferIfRunActive: true
    });
    sendJson(res, { ok: true, refresh });
  })
];
