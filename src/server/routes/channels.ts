import { getChannelRegistry } from '#lib/server/capabilities/channel-registry';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import { getStore } from '#lib/server/persistence/store';
import { providerLocksOwnerIdentity, requireMatchingSetupOwner } from '#lib/server/setup/owner-identity';
import { readBody, readJson, redirect, sendJson, toHeaders } from '../http.js';
import { route, type Route } from '../router.js';
import type { Workspace } from '#lib/types';

function getProviderWorkspace(provider: string, workspaceId?: string): Workspace | undefined {
  const store = getStore();
  if (workspaceId) {
    const workspace = store.getWorkspaceById(workspaceId);
    return workspace?.provider === provider ? workspace : undefined;
  }
  return store.listWorkspaces().find((workspace) => workspace.provider === provider);
}

function sendUnsupported(res: Parameters<typeof sendJson>[0], provider: string, capability: string): void {
  sendJson(res, { ok: false, error: `unsupported_channel_${capability}:${provider}` }, 400);
}

export const channelRoutes: Route[] = [
  route('GET', '/api/channels/providers', async ({ res }) => {
    await ensureRuntimeInitialized();
    sendJson(res, {
      ok: true,
      providers: getChannelRegistry().list()
    });
  }),
  route('GET', '/api/channels/:provider/setup/status', async ({ res, params }) => {
    await ensureRuntimeInitialized();
    const setup = getChannelRegistry().getSetup(params.provider);
    if (!setup?.getStatus) {
      sendUnsupported(res, params.provider, 'status');
      return;
    }
    sendJson(res, { ok: true, provider: params.provider, status: await setup.getStatus() });
  }),
  route('GET', '/api/channels/:provider/members', async ({ res, url, params }) => {
    await ensureRuntimeInitialized();
    const workspace = getProviderWorkspace(params.provider, url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }
    if (providerLocksOwnerIdentity(workspace.provider)) {
      sendJson(res, { ok: false, error: 'owner_identity_locked', members: [] }, 410);
      return;
    }
    sendJson(res, {
      ok: true,
      workspaceId: workspace.id,
      provider: workspace.provider,
      members: await getChannelRegistry().listMembers(workspace)
    });
  }),
  route('GET', '/api/channels/:provider/members/:userId', async ({ res, url, params }) => {
    await ensureRuntimeInitialized();
    const workspace = getProviderWorkspace(params.provider, url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }
    const ownerCheck = requireMatchingSetupOwner(workspace, params.userId);
    if (!ownerCheck.ok) {
      sendJson(res, {
        ok: false,
        error: ownerCheck.error,
        workspaceId: workspace.id,
        provider: workspace.provider,
        owner: ownerCheck.owner
      }, 400);
      return;
    }
    sendJson(res, {
      ok: true,
      workspaceId: workspace.id,
      provider: workspace.provider,
      member: await getChannelRegistry().getMember(workspace, params.userId)
    });
  }),
  route('GET', '/api/channels/:provider/channels', async ({ res, url, params }) => {
    await ensureRuntimeInitialized();
    const workspace = getProviderWorkspace(params.provider, url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }
    sendJson(res, {
      ok: true,
      workspaceId: workspace.id,
      provider: workspace.provider,
      channels: await getChannelRegistry().listChannels(workspace)
    });
  }),
  route('GET', '/api/channels/:provider/channels/:channelId', async ({ res, url, params }) => {
    await ensureRuntimeInitialized();
    const workspace = getProviderWorkspace(params.provider, url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }
    sendJson(res, {
      ok: true,
      workspaceId: workspace.id,
      provider: workspace.provider,
      channel: await getChannelRegistry().getChannel(workspace, params.channelId)
    });
  }),
  route('POST', '/api/channels/:provider/setup/:action', async ({ req, res, url, params }) => {
    await ensureRuntimeInitialized();
    const setup = getChannelRegistry().getSetup(params.provider);
    if (!setup?.handleSetupAction) {
      sendUnsupported(res, params.provider, 'setup_action');
      return;
    }
    const body = await readJson<Record<string, unknown>>(req);
    sendJson(res, {
      ok: true,
      provider: params.provider,
      result: await setup.handleSetupAction({ action: params.action, body, url })
    });
  }),
  route('GET', '/api/channels/:provider/oauth/callback', async ({ res, url, params }) => {
    await ensureRuntimeInitialized();
    const setup = getChannelRegistry().getSetup(params.provider);
    if (!setup?.handleOAuthCallback) {
      sendUnsupported(res, params.provider, 'oauth_callback');
      return;
    }
    const result = await setup.handleOAuthCallback({ url });
    if (result && typeof result === 'object' && 'redirect' in result && typeof result.redirect === 'string') {
      redirect(res, result.redirect);
      return;
    }
    sendJson(res, { ok: true, provider: params.provider, result });
  }),
  route('POST', '/api/channels/:provider/events', async ({ req, res, url, params }) => {
    await ensureRuntimeInitialized();
    const ingress = getChannelRegistry().getIngress(params.provider);
    if (!ingress?.handleWebhook) {
      sendUnsupported(res, params.provider, 'webhook');
      return;
    }
    const rawBody = await readBody(req);
    const result = await ingress.handleWebhook({
      rawBody,
      headers: toHeaders(req),
      url
    });
    sendJson(res, result);
  })
];
