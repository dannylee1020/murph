import { getRuntimeEnv } from '#lib/server/util/env';
import { getStore } from '#lib/server/persistence/store';
import { getSlackService } from '#lib/server/channels/slack/service';
import { getGitHubService } from '#lib/server/context-sources/github';
import { getIntegration, listIntegrations, readEnvCredential } from '#lib/server/integrations/registry';
import { loadIntegrationAdapters } from '#lib/server/integrations/adapter-loader';
import { registerBuiltInIntegrationAdapters } from '#lib/server/integrations/register-builtins';
import { maskCredential } from '#lib/server/integrations/credentials';
import {
  enableIntegrationCapabilities,
  disableIntegrationCapabilities
} from '#lib/server/integrations/capabilities';
import { deleteSecret, maskSecret, readSecretRecord, writeSecret } from '#lib/server/credentials/local-store';
import { readJson, sendJson } from '../http.js';
import { route, type Route } from '../router.js';

interface ConnectBody {
  workspaceId?: string;
  credential?: string;
}

interface GitHubRepositoriesBody {
  workspaceId?: string;
  repositories?: unknown;
}

function normalizeRepositories(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter((entry) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry)))];
}

function getTargetWorkspace(workspaceId?: string) {
  const store = getStore();
  if (workspaceId) {
    return store.getWorkspaceById(workspaceId);
  }

  return getSlackService().getUsableWorkspace() ??
    store.getFirstWorkspace();
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

  return {};
}

async function ensureIntegrationRegistryLoaded(): Promise<void> {
  registerBuiltInIntegrationAdapters();
  await loadIntegrationAdapters();
}

function statusFor(provider: string, workspaceId: string) {
  const definition = getIntegration(provider)!;
  const stored = getStore().getIntegrationCredential(workspaceId, provider);
  const envValue = readEnvCredential(provider);
  const key = definition.credentialKind === 'oauth_bundle' ? 'oauth_bundle' : 'api_key';
  const local = readSecretRecord(provider, key, { workspaceId }) ?? readSecretRecord(provider, key);
  const source = envValue ? 'env' : local ? 'credentials' : stored?.status === 'connected' ? 'database' : undefined;
  const metadata = source === 'credentials'
    ? local?.metadata ?? {}
    : source === 'database'
      ? stored?.metadata ?? {}
      : envValue
      ? { masked: maskCredential(envValue) }
      : {};
  const githubRepositories = provider === 'github'
    ? source === 'env'
      ? getRuntimeEnv().githubRepositories
      : normalizeRepositories(metadata.repositories).length > 0
        ? normalizeRepositories(metadata.repositories)
        : getRuntimeEnv().githubRepositories
    : undefined;

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
    canDisconnect: source === 'credentials' || source === 'database',
    metadata: provider === 'github'
      ? { ...metadata, repositories: githubRepositories, needsRepoScope: source ? (githubRepositories ?? []).length === 0 : false }
      : metadata,
    errorMessage: stored?.errorMessage
  };
}

export const integrationRoutes: Route[] = [
  route('GET', '/api/integrations/status', async ({ res, url }) => {
    await ensureIntegrationRegistryLoaded();
    const workspace = getTargetWorkspace(url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }

    sendJson(res, {
      ok: true,
      workspaceId: workspace.id,
      integrations: listIntegrations().map((integration) => statusFor(integration.provider, workspace.id))
    });
  }),
  route('POST', '/api/integrations/:provider/connect', async ({ req, res, params }) => {
    await ensureIntegrationRegistryLoaded();
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

    try {
      const validationMetadata = await validateCredential(definition.provider, credential);
      const key = definition.credentialKind === 'oauth_bundle' ? 'oauth_bundle' : 'api_key';
      const metadata = {
        ...validationMetadata,
        masked: maskSecret(credential),
        validatedAt: new Date().toISOString()
      };
      writeSecret(definition.provider, key, credential, {
        workspaceId: workspace.id,
        externalWorkspaceId: workspace.externalWorkspaceId,
        metadata
      });
      getStore().saveIntegrationCredential({
        workspaceId: workspace.id,
        provider: definition.provider,
        credentialKind: definition.credentialKind,
        credentialEncrypted: 'stored-in-local-credentials',
        metadata
      });
      enableIntegrationCapabilities(workspace.id, definition);
      sendJson(res, { ok: true, integration: statusFor(definition.provider, workspace.id) });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'validation_failed' }, 400);
    }
  }),
  route('GET', '/api/integrations/github/repositories', async ({ res, url }) => {
    await ensureIntegrationRegistryLoaded();
    const workspace = getTargetWorkspace(url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required', repositories: [], selectedRepositories: [] }, 400);
      return;
    }

    try {
      const result = await getGitHubService().listRepositories(workspace.id);
      sendJson(res, {
        ok: true,
        repositories: result.repositories,
        selectedRepositories: getGitHubService().repositories(workspace.id)
      });
    } catch (error) {
      sendJson(res, {
        ok: false,
        error: error instanceof Error ? error.message : 'repository_list_failed',
        repositories: [],
        selectedRepositories: getGitHubService().repositories(workspace.id)
      }, 400);
    }
  }),
  route('PUT', '/api/integrations/github/repositories', async ({ req, res }) => {
    await ensureIntegrationRegistryLoaded();
    const definition = getIntegration('github')!;
    const body = await readJson<GitHubRepositoriesBody>(req);
    const workspace = getTargetWorkspace(body.workspaceId);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }

    const stored = getStore().getIntegrationCredential(workspace.id, 'github');
    const local = readSecretRecord('github', 'api_key', { workspaceId: workspace.id });
    if (!stored && !local) {
      sendJson(res, { ok: false, error: 'github_not_connected' }, 400);
      return;
    }

    const repositories = normalizeRepositories(body.repositories);
    if (local) {
      writeSecret('github', 'api_key', local.value, {
        workspaceId: workspace.id,
        externalWorkspaceId: workspace.externalWorkspaceId,
        metadata: {
          ...local.metadata,
          repositories
        }
      });
    }
    getStore().saveIntegrationCredential({
      workspaceId: workspace.id,
      provider: 'github',
      credentialKind: stored?.credentialKind ?? 'api_key',
      credentialEncrypted: stored?.credentialEncrypted ?? 'stored-in-local-credentials',
      metadata: {
        ...(stored?.metadata ?? local?.metadata),
        repositories
      },
      status: stored?.status,
      errorMessage: stored?.errorMessage
    });

    enableIntegrationCapabilities(workspace.id, definition);

    sendJson(res, { ok: true, integration: statusFor('github', workspace.id) });
  }),
  route('DELETE', '/api/integrations/:provider/disconnect', async ({ res, params, url }) => {
    await ensureIntegrationRegistryLoaded();
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

    const key = definition.credentialKind === 'oauth_bundle' ? 'oauth_bundle' : 'api_key';
    deleteSecret(definition.provider, key, { workspaceId: workspace.id });
    getStore().deleteIntegrationCredential(workspace.id, definition.provider);
    if (!readEnvCredential(definition.provider)) {
      disableIntegrationCapabilities(workspace.id, definition);
    }
    sendJson(res, { ok: true, integration: statusFor(definition.provider, workspace.id) });
  })
];
