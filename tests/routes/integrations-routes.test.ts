import { Readable } from 'node:stream';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type JsonResponse = {
  status: number;
  body: any;
};

function jsonRequest(method: string, body?: unknown): any {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
  req.method = method;
  req.headers = {};
  return req;
}

function jsonResponse(): any & { result: () => JsonResponse } {
  let status = 200;
  let payload = '';
  return {
    writeHead(nextStatus: number) {
      status = nextStatus;
    },
    end(nextPayload: string) {
      payload = nextPayload;
    },
    result() {
      return { status, body: JSON.parse(payload) };
    }
  };
}

async function setup(options: { githubPat?: string } = {}) {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-integrations-route-'));
  const murphHome = join(root, '.murph');
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
  process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
  process.env.MURPH_HOME = murphHome;
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  if (options.githubPat) {
    process.env.GITHUB_PAT = options.githubPat;
  } else {
    process.env.GITHUB_PAT = '';
  }
  process.env.NOTION_API_KEY = '';
  process.env.OBSIDIAN_VAULT_PATH = '';
  process.env.GOOGLE_ACCESS_TOKEN = '';
  process.env.GOOGLE_CLIENT_ID = '';
  process.env.GOOGLE_CLIENT_SECRET = '';
  process.env.LINEAR_API_KEY = '';
  mkdirSync(join(murphHome, 'plugins'), { recursive: true });

  const { getStore } = await import('#lib/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  const { integrationRoutes } = await import('../../src/server/routes/integrations');
  const { dispatchRoute } = await import('../../src/server/router');

  async function request(method: string, path: string, body?: unknown) {
    const req = jsonRequest(method, body);
    const res = jsonResponse();
    await dispatchRoute(integrationRoutes, {
      req,
      res,
      url: new URL(path, 'http://localhost')
    });
    return res.result();
  }

  return { request, store, workspace, murphHome };
}

function writeLinearPlugin(murphHome: string): void {
  const root = join(murphHome, 'plugins', 'context', 'linear');
  mkdirSync(join(root, 'integrations'), { recursive: true });
  writeFileSync(join(root, 'plugin.json'), JSON.stringify({
    id: 'linear',
    name: 'Linear',
    description: 'Linear issue and project context',
    version: '0.1.0',
    capabilities: {
      integrations: ['integrations/linear.mjs']
    }
  }));
  writeFileSync(join(root, 'integrations', 'linear.mjs'), `
export default {
  id: 'linear',
  name: 'Linear',
  description: 'Linear issues, projects, and specs.',
  credential: {
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'LINEAR_API_KEY',
    credentialLabel: 'Linear API key'
  },
  tools: [{
    name: 'linear.read_issue',
    description: 'Read a Linear issue by id.',
    sideEffectClass: 'read',
    async execute() {
      return { ok: true };
    }
  }],
  contextSources: [{
    name: 'linear.thread_search',
    description: 'Search Linear issues from thread context.',
    optional: true,
    async retrieve() {
      return [];
    }
  }],
  isConfigured() {
    return Boolean(process.env.LINEAR_API_KEY);
  }
};
`);
}

describe('integration routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.MURPH_HOME;
    delete process.env.LINEAR_API_KEY;
  });

  it('validates, stores, and reports a GitHub credential', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ login: 'octo-user' })
    }));
    const { request, store, workspace } = await setup();
    const discordWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Test Guild',
      botUserId: 'DBOT'
    });

    const response = await request('POST', '/api/integrations/github/connect', {
      workspaceId: workspace.id,
      credential: 'ghp_test_token'
    });

    expect(response.status).toBe(200);
    expect(response.body.integration).toEqual(
      expect.objectContaining({
        provider: 'github',
        status: 'connected',
        source: 'credentials',
        canDisconnect: true,
        metadata: expect.objectContaining({
          repositories: [],
          needsRepoScope: true
        })
      })
    );
    const stored = store.getIntegrationConnection(workspace.id, 'github');
    expect(stored).toEqual(expect.objectContaining({
      provider: 'github',
      credentialKind: 'api_key',
      status: 'connected'
    }));
    const { readSecret } = await import('#lib/server/credentials/local-store');
    expect(readSecret('github', 'api_key')).toBe('ghp_test_token');
    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).not.toContain('github.search');
    expect(memory.enabledContextSources).not.toContain('github.thread_search');
    const discordMemory = store.getOrCreateWorkspaceMemory(discordWorkspace.id);
    expect(discordMemory.enabledOptionalTools).not.toContain('github.search');
    expect(discordMemory.enabledContextSources).not.toContain('github.thread_search');

    const discordStatus = await request('GET', `/api/integrations/status?workspaceId=${discordWorkspace.id}`);
    const discordGithub = discordStatus.body.integrations.find((integration: any) => integration.provider === 'github');
    expect(discordGithub).toEqual(expect.objectContaining({
      provider: 'github',
      status: 'connected',
      source: 'credentials'
    }));
  });

  it('saves GitHub repositories and enables GitHub retrieval capabilities', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ login: 'octo-user' })
    }));
    const { request, store, workspace } = await setup();
    await request('POST', '/api/integrations/github/connect', {
      workspaceId: workspace.id,
      credential: 'ghp_test_token'
    });

    const response = await request('PUT', '/api/integrations/github/repositories', {
      workspaceId: workspace.id,
      repositories: ['octo/app']
    });

    expect(response.status).toBe(200);
    expect(response.body.integration.metadata).toEqual(
      expect.objectContaining({
        repositories: ['octo/app'],
        needsRepoScope: false
      })
    );
    const stored = store.getIntegrationConnection(workspace.id, 'github');
    expect(stored?.metadata.repositories).toEqual(['octo/app']);
    const { readSecretRecord } = await import('#lib/server/credentials/local-store');
    expect(readSecretRecord('github', 'api_key')?.metadata?.repositories).toEqual(['octo/app']);
    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).toContain('github.search');
    expect(memory.enabledContextSources).toContain('github.thread_search');
  });

  it('makes Notion tools available to another channel workspace after one connect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'murph-adapter' })
    }));
    const { request, store, workspace } = await setup();
    const discordWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Test Guild',
      botUserId: 'DBOT'
    });

    const response = await request('POST', '/api/integrations/notion/connect', {
      workspaceId: workspace.id,
      credential: 'secret_notion_token'
    });

    expect(response.status).toBe(200);
    const discordStatus = await request('GET', `/api/integrations/status?workspaceId=${discordWorkspace.id}`);
    const notion = discordStatus.body.integrations.find((integration: any) => integration.provider === 'notion');
    expect(notion).toEqual(expect.objectContaining({
      provider: 'notion',
      status: 'connected',
      source: 'credentials'
    }));
    const memory = store.getOrCreateWorkspaceMemory(discordWorkspace.id);
    expect(memory.enabledOptionalTools).toEqual(expect.arrayContaining(['notion.search', 'notion.read_page']));
    expect(memory.enabledContextSources).toContain('notion.thread_search');
  });

  it('lists Obsidian as a path-based connector for the integration card UI', async () => {
    const { request, workspace } = await setup();

    const response = await request('GET', `/api/integrations/status?workspaceId=${workspace.id}`);
    const obsidian = response.body.integrations.find((integration: any) => integration.provider === 'obsidian');

    expect(response.status).toBe(200);
    expect(obsidian).toEqual(expect.objectContaining({
      provider: 'obsidian',
      name: 'Obsidian',
      status: 'disconnected',
      authType: 'path',
      credentialLabel: 'Vault path',
      envKey: 'OBSIDIAN_VAULT_PATH',
      tools: ['obsidian.search', 'obsidian.read_note'],
      contextSources: ['obsidian.thread_search']
    }));
  });

  it('surfaces plugin-provided integrations in status after plugin reload', async () => {
    const { request, workspace, murphHome } = await setup();
    writeLinearPlugin(murphHome);

    const { reloadScopedPlugins } = await import('#lib/server/plugins/loader');
    const pluginStatuses = await reloadScopedPlugins();
    const response = await request('GET', `/api/integrations/status?workspaceId=${workspace.id}`);
    const linear = response.body.integrations.find((integration: any) => integration.provider === 'linear');

    expect(pluginStatuses).toEqual([
      expect.objectContaining({
        id: 'linear',
        status: 'loaded',
        capabilities: expect.objectContaining({
          integrations: ['linear']
        })
      })
    ]);
    expect(response.status).toBe(200);
    expect(linear).toEqual(expect.objectContaining({
      provider: 'linear',
      name: 'Linear',
      description: 'Linear issues, projects, and specs.',
      status: 'disconnected',
      authType: 'api_key',
      credentialLabel: 'Linear API key',
      envKey: 'LINEAR_API_KEY',
      tools: ['linear.read_issue'],
      contextSources: ['linear.thread_search']
    }));
  });

  it('connects Obsidian with a local vault path without storing a secret', async () => {
    const { request, store, workspace } = await setup();
    const vault = mkdtempSync(join(tmpdir(), 'murph-obsidian-vault-'));
    const realVault = realpathSync(vault);
    writeFileSync(join(vault, 'Plan.md'), 'Launch readiness notes');

    const response = await request('POST', '/api/integrations/obsidian/connect', {
      workspaceId: workspace.id,
      vaultPath: vault
    });

    expect(response.status).toBe(200);
    expect(response.body.integration).toEqual(expect.objectContaining({
      provider: 'obsidian',
      status: 'connected',
      source: 'config',
      authType: 'path',
      credentialLabel: 'Vault path',
      canDisconnect: true,
      metadata: expect.objectContaining({
        vaultPath: realVault
      })
    }));
    const { readSecretRecord } = await import('#lib/server/credentials/local-store');
    expect(readSecretRecord('obsidian', 'config_path')).toBeUndefined();
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain(`vaultPath: ${realVault}`);
    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).toEqual(expect.arrayContaining(['obsidian.search', 'obsidian.read_note']));
    expect(memory.enabledContextSources).toContain('obsidian.thread_search');
  });

  it('rejects invalid Obsidian vault paths', async () => {
    const { request, workspace } = await setup();
    const file = join(mkdtempSync(join(tmpdir(), 'murph-obsidian-file-')), 'note.md');
    writeFileSync(file, 'not a vault directory');

    const response = await request('POST', '/api/integrations/obsidian/connect', {
      workspaceId: workspace.id,
      vaultPath: file
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('must be a directory');
  });

  it('disconnects Obsidian config and disables its retrieval capabilities', async () => {
    const { request, store, workspace } = await setup();
    const vault = mkdtempSync(join(tmpdir(), 'murph-obsidian-vault-'));
    mkdirSync(join(vault, 'Notes'));
    writeFileSync(join(vault, 'Notes', 'Plan.md'), 'Launch readiness notes');
    await request('POST', '/api/integrations/obsidian/connect', {
      workspaceId: workspace.id,
      vaultPath: vault
    });

    const response = await request('DELETE', `/api/integrations/obsidian/disconnect?workspaceId=${workspace.id}`);

    expect(response.status).toBe(200);
    expect(response.body.integration).toEqual(expect.objectContaining({
      provider: 'obsidian',
      status: 'disconnected'
    }));
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).not.toContain('vaultPath');
    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).not.toContain('obsidian.search');
    expect(memory.enabledOptionalTools).not.toContain('obsidian.read_note');
    expect(memory.enabledContextSources).not.toContain('obsidian.thread_search');
  });

  it('reports global credentials before env fallback when both are present', async () => {
    const { request, store, workspace } = await setup({ githubPat: 'env-token' });
    const { writeSecret } = await import('#lib/server/credentials/local-store');
    writeSecret('github', 'api_key', 'stored-token', {
      metadata: { masked: '****oken', repositories: ['octo/app'] }
    });
    store.saveIntegrationConnection({
      workspaceId: workspace.id,
      provider: 'github',
      credentialKind: 'api_key',
      metadata: { masked: '****oken', repositories: ['octo/app'] }
    });

    const response = await request('GET', `/api/integrations/status?workspaceId=${workspace.id}`);
    const github = response.body.integrations.find((integration: any) => integration.provider === 'github');

    expect(response.status).toBe(200);
    expect(github).toEqual(expect.objectContaining({
      provider: 'github',
      status: 'connected',
      source: 'credentials',
      metadata: expect.objectContaining({
        repositories: ['octo/app'],
        needsRepoScope: false
      })
    }));
  });

  it('ignores legacy scoped credentials in status', async () => {
    const { request, workspace } = await setup();
    const { writeSecret } = await import('#lib/server/credentials/local-store');
    writeSecret('github', 'api_key', 'scoped-token', { workspaceId: workspace.id });

    const response = await request('GET', `/api/integrations/status?workspaceId=${workspace.id}`);
    const github = response.body.integrations.find((integration: any) => integration.provider === 'github');

    expect(response.status).toBe(200);
    expect(github).toEqual(expect.objectContaining({
      provider: 'github',
      status: 'disconnected'
    }));
    expect(github.source).toBeUndefined();
  });

  it('disconnects stored credentials while keeping env fallback visible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ login: 'octo-user' })
    }));
    const { request, workspace } = await setup({ githubPat: 'env-token' });
    await request('POST', '/api/integrations/github/connect', {
      workspaceId: workspace.id,
      credential: 'ghp_test_token'
    });
    const response = await request('DELETE', `/api/integrations/github/disconnect?workspaceId=${workspace.id}`);

    expect(response.status).toBe(200);
    expect(response.body.integration).toEqual(
      expect.objectContaining({
        provider: 'github',
        status: 'connected',
        source: 'env',
        canDisconnect: false
      })
    );
  });

  it('disconnects a global stored credential from all workspaces', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ login: 'octo-user' })
    }));
    const { request, store, workspace } = await setup();
    const discordWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Test Guild',
      botUserId: 'DBOT'
    });
    await request('POST', '/api/integrations/github/connect', {
      workspaceId: workspace.id,
      credential: 'ghp_test_token'
    });

    const response = await request('DELETE', `/api/integrations/github/disconnect?workspaceId=${discordWorkspace.id}`);

    expect(response.status).toBe(200);
    expect(response.body.integration).toEqual(expect.objectContaining({
      provider: 'github',
      status: 'disconnected'
    }));
    expect(store.getIntegrationConnection(workspace.id, 'github')).toBeUndefined();
    expect(store.getIntegrationConnection(discordWorkspace.id, 'github')).toBeUndefined();
    expect(store.getOrCreateWorkspaceMemory(workspace.id).enabledOptionalTools).not.toContain('github.search');
    expect(store.getOrCreateWorkspaceMemory(discordWorkspace.id).enabledOptionalTools).not.toContain('github.search');
  });

  it('reports Google as connected when an OAuth bundle is stored for the workspace', async () => {
    const { request, store, workspace } = await setup();
    const { writeSecret } = await import('#lib/server/credentials/local-store');
    const metadata = {
      account: 'person@example.com',
      validatedAt: new Date().toISOString()
    };
    writeSecret('google', 'oauth_bundle', JSON.stringify({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: Date.now() + 3600_000,
      scope: 'gmail calendar'
    }), {
      metadata
    });
    store.saveIntegrationConnection({
      workspaceId: workspace.id,
      provider: 'google',
      credentialKind: 'oauth_bundle',
      metadata
    });

    const response = await request('GET', `/api/integrations/status?workspaceId=${workspace.id}`);
    const google = response.body.integrations.find((integration: any) => integration.provider === 'google');

    expect(response.status).toBe(200);
    expect(google).toEqual(expect.objectContaining({
      provider: 'google',
      status: 'connected',
      source: 'credentials'
    }));
    expect(google.metadata).toEqual(expect.objectContaining({
      account: 'person@example.com'
    }));
  });

  it('reports Google as connected from a global OAuth bundle across channel workspaces', async () => {
    const { request, store, workspace } = await setup();
    const { writeSecret } = await import('#lib/server/credentials/local-store');
    const discordWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Test Guild',
      botUserId: 'DBOT'
    });
    const metadata = {
      account: 'person@example.com',
      validatedAt: new Date().toISOString()
    };
    writeSecret('google', 'oauth_bundle', JSON.stringify({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: Date.now() + 3600_000,
      scope: 'gmail calendar'
    }), {
      metadata
    });
    store.saveIntegrationConnection({
      workspaceId: workspace.id,
      provider: 'google',
      credentialKind: 'oauth_bundle',
      metadata
    });

    const response = await request('GET', `/api/integrations/status?workspaceId=${discordWorkspace.id}`);
    const google = response.body.integrations.find((integration: any) => integration.provider === 'google');

    expect(response.status).toBe(200);
    expect(google).toEqual(expect.objectContaining({
      provider: 'google',
      status: 'connected',
      source: 'credentials'
    }));
    expect(google.metadata).toEqual(expect.objectContaining({
      account: 'person@example.com'
    }));
  });

  it('ignores legacy scoped Google OAuth bundles in status', async () => {
    const { request, workspace } = await setup();
    const { writeSecret } = await import('#lib/server/credentials/local-store');
    writeSecret('google', 'oauth_bundle', JSON.stringify({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: Date.now() + 3600_000,
      scope: 'gmail calendar'
    }), {
      workspaceId: workspace.id,
      metadata: { account: 'person@example.com' }
    });

    const response = await request('GET', `/api/integrations/status?workspaceId=${workspace.id}`);
    const google = response.body.integrations.find((integration: any) => integration.provider === 'google');

    expect(response.status).toBe(200);
    expect(google).toEqual(expect.objectContaining({
      provider: 'google',
      status: 'disconnected'
    }));
    expect(google.source).toBeUndefined();
  });
});
