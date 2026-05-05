import { encryptString } from '#lib/server/util/crypto';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getStore } from '#lib/server/persistence/store';
import { getIntegration, INTEGRATIONS, readEnvCredential } from '#lib/server/integrations/registry';
import { maskCredential } from '#lib/server/integrations/credentials';
import {
  enableIntegrationCapabilities,
  disableIntegrationCapabilities
} from '#lib/server/integrations/capabilities';
import { readJson, sendJson } from '../http.js';
import { route, type Route } from '../router.js';

interface ConnectBody {
  workspaceId?: string;
  credential?: string;
}

function getTargetWorkspace(workspaceId?: string) {
  const store = getStore();
  return workspaceId ? store.getWorkspaceById(workspaceId) : store.getFirstWorkspace();
}

async function validateCredential(provider: string, credential: string): Promise<Record<string, unknown>> {
  if (provider === 'github') {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${credential}`,
        'User-Agent': 'murph'
      }
    });
    const payload = await response.json().catch(() => ({})) as { login?: string; message?: string };
    if (!response.ok) {
      throw new Error(payload.message ?? `GitHub validation failed with ${response.status}`);
    }
    return { account: payload.login };
  }

  if (provider === 'notion') {
    const response = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        authorization: `Bearer ${credential}`,
        'notion-version': getRuntimeEnv().notionVersion
      }
    });
    const payload = await response.json().catch(() => ({})) as { name?: string; bot?: { owner?: unknown }; message?: string };
    if (!response.ok) {
      throw new Error(payload.message ?? `Notion validation failed with ${response.status}`);
    }
    return { account: payload.name };
  }

  if (provider === 'granola') {
    const response = await fetch('https://public-api.granola.ai/v1/notes?page_size=1', {
      headers: { Authorization: `Bearer ${credential}` }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(payload.message ?? `Granola validation failed with ${response.status}`);
    }
    return {};
  }

  throw new Error('Unsupported integration provider');
}

function statusFor(provider: string, workspaceId: string) {
  const definition = getIntegration(provider)!;
  const stored = getStore().getIntegrationCredential(workspaceId, provider);
  const envValue = readEnvCredential(provider);
  const source = stored?.status === 'connected' ? 'database' : envValue ? 'env' : undefined;

  return {
    provider: definition.provider,
    name: definition.name,
    description: definition.description,
    authType: definition.authType,
    credentialLabel: definition.credentialLabel,
    status: source ? 'connected' : 'disconnected',
    source,
    envKey: definition.envKey,
    installPath: definition.installPath,
    tools: definition.tools,
    contextSources: definition.contextSources,
    canDisconnect: source === 'database',
    metadata: source === 'database'
      ? stored?.metadata ?? {}
      : envValue
        ? { masked: maskCredential(envValue) }
        : {},
    errorMessage: stored?.errorMessage
  };
}

export const integrationRoutes: Route[] = [
  route('GET', '/api/integrations/status', ({ res, url }) => {
    const workspace = getTargetWorkspace(url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }

    sendJson(res, {
      ok: true,
      workspaceId: workspace.id,
      integrations: INTEGRATIONS.map((integration) => statusFor(integration.provider, workspace.id))
    });
  }),
  route('POST', '/api/integrations/:provider/connect', async ({ req, res, params }) => {
    const definition = getIntegration(params.provider);
    if (!definition) {
      sendJson(res, { ok: false, error: 'unsupported_provider' }, 404);
      return;
    }

    const body = await readJson<ConnectBody>(req);
    const workspace = getTargetWorkspace(body.workspaceId);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }

    const credential = body.credential?.trim();
    if (!credential) {
      sendJson(res, { ok: false, error: 'credential_required' }, 400);
      return;
    }

    const encryptionKey = getRuntimeEnv().encryptionKey;
    if (!encryptionKey) {
      sendJson(res, { ok: false, error: 'encryption_key_required' }, 400);
      return;
    }

    try {
      const validationMetadata = await validateCredential(definition.provider, credential);
      getStore().saveIntegrationCredential({
        workspaceId: workspace.id,
        provider: definition.provider,
        credentialKind: definition.credentialKind,
        credentialEncrypted: encryptString(credential, encryptionKey),
        metadata: {
          ...validationMetadata,
          masked: maskCredential(credential),
          validatedAt: new Date().toISOString()
        }
      });
      enableIntegrationCapabilities(workspace.id, definition);
      sendJson(res, { ok: true, integration: statusFor(definition.provider, workspace.id) });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'validation_failed' }, 400);
    }
  }),
  route('DELETE', '/api/integrations/:provider/disconnect', ({ res, params, url }) => {
    const definition = getIntegration(params.provider);
    if (!definition) {
      sendJson(res, { ok: false, error: 'unsupported_provider' }, 404);
      return;
    }

    const workspace = getTargetWorkspace(url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }

    getStore().deleteIntegrationCredential(workspace.id, definition.provider);
    if (!readEnvCredential(definition.provider)) {
      disableIntegrationCapabilities(workspace.id, definition);
    }
    sendJson(res, { ok: true, integration: statusFor(definition.provider, workspace.id) });
  })
];
