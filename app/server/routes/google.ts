import type { IncomingMessage } from 'node:http';
import { resolvePublicAppUrl } from '#app/server/auth/dashboard-access';
import { getStore } from '#app/server/persistence/store';
import { getSlackService } from '#app/server/channels/slack/service';
import { getIntegration } from '#app/server/integrations/registry';
import { getRuntimeEnv } from '#app/server/util/env';
import {
  isGoogleOAuthConfigured,
  buildGoogleInstallUrl,
  exchangeGoogleCode,
  revokeGoogleToken
} from '#app/server/integrations/google-oauth';
import {
  enableIntegrationCapabilitiesForAllWorkspaces,
  disableIntegrationCapabilitiesForAllWorkspaces
} from '#app/server/integrations/capabilities';
import { refreshRuntimeState } from '#app/server/runtime/refresh';
import { redirect, sendJson } from '../http.js';
import { route, type Route } from '../router.js';

function publicAppUrl(req: IncomingMessage, url: URL): string {
  return resolvePublicAppUrl(req, url);
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
    if (!getIntegration('google', { distribution: getRuntimeEnv().distribution })) {
      redirect(res, '/settings?error=google_not_available');
      return;
    }

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
      const definition = getIntegration('google', { distribution: getRuntimeEnv().distribution });
      if (!definition) {
        redirect(res, '/settings?error=google_not_available');
        return;
      }

      const base = publicAppUrl(req, url);
      const redirectUri = `${base}/api/google/oauth/callback`;
      await exchangeGoogleCode(code, redirectUri, workspace.id);

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
    const definition = getIntegration('google', { distribution: getRuntimeEnv().distribution });
    if (!definition) {
      sendJson(res, { ok: false, error: 'unsupported_provider' }, 404);
      return;
    }

    const workspace = getTargetWorkspace(url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }

    await revokeGoogleToken(workspace.id);
    const store = getStore();
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
