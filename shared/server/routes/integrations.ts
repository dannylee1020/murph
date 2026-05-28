import { getRuntimeEnv } from '#shared/server/util/env';
import { resetRuntimeEnvCache } from '#shared/server/util/env';
import { refreshRuntimeState } from '#shared/server/runtime/refresh';
import { getStore } from '#shared/server/persistence/store';
import { getSlackService } from '#shared/server/channels/slack/service';
import { getGitHubService } from '#shared/server/context-sources/github';
import {
  getObsidianConnectionStatus,
  validateObsidianVaultPath
} from '#shared/server/context-sources/obsidian';
import { getIntegration, listIntegrations, readEnvCredential } from '#shared/server/integrations/registry';
import { loadIntegrationAdapters } from '#shared/server/integrations/adapter-loader';
import { registerBuiltInIntegrationAdapters } from '#shared/server/integrations/register-builtins';
import { maskCredential } from '#shared/server/integrations/credentials';
import {
  effectiveIntegrationCredential,
  enableIntegrationCapabilitiesForAllWorkspaces,
  disableIntegrationCapabilitiesForAllWorkspaces,
  MISSING_INTEGRATION_CREDENTIAL_MESSAGE
} from '#shared/server/integrations/capabilities';
import { maskSecret, writeSecret } from '#shared/server/credentials/local-store';
import {
  deleteIntegrationConnectionForAllWorkspaces,
  deleteIntegrationCredentialEverywhere,
  globalIntegrationCredential,
  integrationCredentialKey,
  saveIntegrationConnectionForAllWorkspaces
} from '#shared/server/integrations/global-scope';
import { updateMurphConfigValues } from '#shared/server/setup/config-file';
import { readJson, sendJson } from '../http.js';
import { route, type Route } from '../router.js';

interface ConnectBody {
  workspaceId?: string;
  credential?: string;
  vaultPath?: string;
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

async function refreshIntegrations(workspaceId?: string) {
  return await refreshRuntimeState({
    reason: 'integration_updated',
    workspaceIds: workspaceId ? [workspaceId] : undefined,
    deferIfRunActive: true
  });
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
  const stored = getStore().getIntegrationConnection(workspaceId, provider);
  const pathStatus = definition.credentialKind === 'config_path' && provider === 'obsidian'
    ? getObsidianConnectionStatus()
    : undefined;
  const effectiveCredential = effectiveIntegrationCredential(definition, workspaceId);
  const { envValue, local, source } = effectiveCredential;
  const env = getRuntimeEnv();
  const reconnectRequired = !source && (
    stored?.status === 'connected' ||
    (stored?.status === 'error' && stored.errorMessage === MISSING_INTEGRATION_CREDENTIAL_MESSAGE)
  );
  const oauthConfigured = provider === 'google'
    ? Boolean(env.googleClientId && env.googleClientSecret)
    : undefined;
  const metadata = definition.credentialKind === 'config_path' && pathStatus?.configured
    ? { ...(stored?.metadata ?? {}), vaultPath: pathStatus.vaultPath }
    : source === 'credentials'
    ? local?.metadata ?? {}
    : envValue
      ? { masked: maskCredential(envValue) }
      : reconnectRequired
      ? stored?.metadata ?? {}
      : {};
  const githubRepositories = provider === 'github'
    ? source === 'credentials' && normalizeRepositories(metadata.repositories).length > 0
        ? normalizeRepositories(metadata.repositories)
        : getRuntimeEnv().githubRepositories
    : undefined;

  return {
    provider: definition.provider,
    name: definition.name,
    description: definition.description,
    authType: definition.authType,
    credentialLabel: definition.credentialLabel,
    status: source ? 'connected' : reconnectRequired ? 'reconnect_required' : 'disconnected',
    source,
    envKey: definition.envKey,
    installPath: definition.installPath,
    tools: definition.tools,
    contextSources: definition.contextSources,
    canDisconnect: source === 'credentials' || source === 'config' || reconnectRequired,
    metadata: provider === 'github'
      ? { ...metadata, repositories: githubRepositories, needsRepoScope: source ? (githubRepositories ?? []).length === 0 : false }
      : oauthConfigured === undefined
        ? metadata
        : { ...metadata, oauthConfigured },
    errorMessage: reconnectRequired
      ? MISSING_INTEGRATION_CREDENTIAL_MESSAGE
      : stored?.errorMessage
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
    const vaultPath = body.vaultPath?.trim() || credential;
    if (definition.credentialKind === 'config_path') {
      if (!vaultPath) {
        sendJson(res, { ok: false, error: 'vault_path_required' }, 400);
        return;
      }
      try {
        const validation = await validateObsidianVaultPath(vaultPath);
        updateMurphConfigValues({ OBSIDIAN_VAULT_PATH: validation.vaultPath });
        resetRuntimeEnvCache();
        const metadata = {
          vaultPath: validation.vaultPath,
          validatedAt: new Date().toISOString()
        };
        saveIntegrationConnectionForAllWorkspaces({
          provider: definition.provider,
          credentialKind: definition.credentialKind,
          metadata
        });
        enableIntegrationCapabilitiesForAllWorkspaces(definition);
        const refresh = await refreshIntegrations(workspace.id);
        sendJson(res, { ok: true, integration: statusFor(definition.provider, workspace.id), refresh });
      } catch (error) {
        sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'validation_failed' }, 400);
      }
      return;
    }

    if (!credential) {
      sendJson(res, { ok: false, error: 'credential_required' }, 400);
      return;
    }

    try {
      const validationMetadata = await validateCredential(definition.provider, credential);
      const key = integrationCredentialKey(definition);
      const metadata = {
        ...validationMetadata,
        masked: maskSecret(credential),
        validatedAt: new Date().toISOString()
      };
      writeSecret(definition.provider, key, credential, { metadata });
      saveIntegrationConnectionForAllWorkspaces({
        provider: definition.provider,
        credentialKind: definition.credentialKind,
        metadata
      });
      if (definition.provider === 'github') {
        disableIntegrationCapabilitiesForAllWorkspaces(definition);
      } else {
        enableIntegrationCapabilitiesForAllWorkspaces(definition);
      }
      const refresh = await refreshIntegrations(workspace.id);
      sendJson(res, { ok: true, integration: statusFor(definition.provider, workspace.id), refresh });
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

    const stored = getStore().getIntegrationConnection(workspace.id, 'github');
    const local = globalIntegrationCredential('github', 'api_key');
    if (!local && !readEnvCredential('github')) {
      sendJson(res, { ok: false, error: 'github_not_connected' }, 400);
      return;
    }

    const repositories = normalizeRepositories(body.repositories);
    if (local) {
      writeSecret('github', 'api_key', local.value, {
        metadata: {
          ...local.metadata,
          repositories
        }
      });
    }
    saveIntegrationConnectionForAllWorkspaces({
      provider: 'github',
      credentialKind: definition.credentialKind,
      metadata: {
        ...(stored?.metadata ?? local?.metadata),
        repositories
      },
      status: stored?.status,
      errorMessage: stored?.errorMessage
    });

    if (repositories.length > 0) {
      enableIntegrationCapabilitiesForAllWorkspaces(definition);
    } else {
      disableIntegrationCapabilitiesForAllWorkspaces(definition);
    }

    const refresh = await refreshIntegrations(workspace.id);
    sendJson(res, { ok: true, integration: statusFor('github', workspace.id), refresh });
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

    const key = integrationCredentialKey(definition);
    if (definition.credentialKind === 'config_path') {
      const currentStatus = getObsidianConnectionStatus();
      if (currentStatus.source !== 'env') {
        updateMurphConfigValues({ OBSIDIAN_VAULT_PATH: '' });
        resetRuntimeEnvCache();
      }
      deleteIntegrationConnectionForAllWorkspaces(definition.provider);
      if (!getObsidianConnectionStatus().configured) {
        disableIntegrationCapabilitiesForAllWorkspaces(definition);
      }
      const refresh = await refreshIntegrations(workspace.id);
      sendJson(res, { ok: true, integration: statusFor(definition.provider, workspace.id), refresh });
      return;
    }

    deleteIntegrationCredentialEverywhere(definition.provider, key);
    deleteIntegrationConnectionForAllWorkspaces(definition.provider);
    if (!readEnvCredential(definition.provider)) {
      disableIntegrationCapabilitiesForAllWorkspaces(definition);
    }
    const refresh = await refreshIntegrations(workspace.id);
    sendJson(res, { ok: true, integration: statusFor(definition.provider, workspace.id), refresh });
  })
];
