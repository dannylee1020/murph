import { Readable } from 'node:stream';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

async function setup(options: { githubPat?: string; linearApiKey?: string; distribution?: 'team' } = {}) {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-integrations-route-'));
  const murphHome = join(root, '.murph');
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
  process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
  process.env.MURPH_HOME = murphHome;
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.MURPH_DISTRIBUTION = options.distribution ?? 'team';
  if (options.githubPat) {
    process.env.GITHUB_PAT = options.githubPat;
  } else {
    process.env.GITHUB_PAT = '';
  }
  process.env.NOTION_API_KEY = '';
  process.env.OBSIDIAN_VAULT_PATH = '';
  process.env.LINEAR_API_KEY = options.linearApiKey ?? '';
  mkdirSync(join(murphHome, 'plugins'), { recursive: true });

  const { getStore } = await import('#app/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  const { integrationRoutes } = await import('../../app/server/routes/integrations');
  const { dispatchRoute } = await import('../../app/server/router');

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

function writeZendeskPlugin(murphHome: string): void {
  const root = join(murphHome, 'plugins', 'context', 'zendesk');
  mkdirSync(join(root, 'integrations'), { recursive: true });
  writeFileSync(join(root, 'plugin.json'), JSON.stringify({
    id: 'zendesk',
    name: 'Zendesk',
    description: 'Zendesk ticket context',
    version: '0.1.0',
    capabilities: {
      integrations: ['integrations/zendesk.mjs']
    }
  }));
  writeFileSync(join(root, 'integrations', 'zendesk.mjs'), `
export default {
  id: 'zendesk',
  name: 'Zendesk',
  description: 'Zendesk tickets and support context.',
  credential: {
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'ZENDESK_API_KEY',
    credentialLabel: 'Zendesk API key'
  },
  tools: [{
    name: 'zendesk.read_ticket',
    description: 'Read a Zendesk ticket by id.',
    sideEffectClass: 'read',
    async execute() {
      return { ok: true };
    }
  }],
  contextSources: [{
    name: 'zendesk.thread_search',
    description: 'Search Zendesk tickets from thread context.',
    optional: true,
    async retrieve() {
      return [];
    }
  }],
  isConfigured() {
    return Boolean(process.env.ZENDESK_API_KEY);
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
    delete process.env.MURPH_DISTRIBUTION;
    delete process.env.LINEAR_API_KEY;
    delete process.env.ZENDESK_API_KEY;
  });

  it('lists only shared-channel-safe default integrations in Murph runtime', async () => {
    const { request, workspace } = await setup({ distribution: 'team' });

    const response = await request('GET', `/api/integrations/status?workspaceId=${workspace.id}`);
    const providers = response.body.integrations.map((integration: any) => integration.provider);

    expect(response.status).toBe(200);
    expect(providers).toEqual(['github', 'notion', 'linear']);
  });

  it('does not report GitHub or Linear connected from blank credentials', async () => {
    const { request, store, workspace } = await setup({ distribution: 'team' });
    const now = new Date().toISOString();
    writeFileSync(process.env.MURPH_CREDENTIALS_PATH!, JSON.stringify({
      version: 1,
      credentials: [
        { provider: 'github', key: 'api_key', value: '', createdAt: now, updatedAt: now },
        { provider: 'linear', key: 'api_key', value: '   ', createdAt: now, updatedAt: now }
      ]
    }));
    store.saveIntegrationConnection({
      workspaceId: workspace.id,
      provider: 'github',
      credentialKind: 'api_key',
      metadata: { masked: '****' }
    });
    store.saveIntegrationConnection({
      workspaceId: workspace.id,
      provider: 'linear',
      credentialKind: 'api_key',
      metadata: { masked: '****' }
    });

    const response = await request('GET', `/api/integrations/status?workspaceId=${workspace.id}`);
    const github = response.body.integrations.find((integration: any) => integration.provider === 'github');
    const linear = response.body.integrations.find((integration: any) => integration.provider === 'linear');

    expect(response.status).toBe(200);
    expect(github).toEqual(expect.objectContaining({ status: 'reconnect_required' }));
    expect(github.source).toBeUndefined();
    expect(linear).toEqual(expect.objectContaining({ status: 'reconnect_required' }));
    expect(linear.source).toBeUndefined();
  });

  it('reports GitHub and Linear connected from server env credentials', async () => {
    const { request, workspace } = await setup({
      distribution: 'team',
      githubPat: 'env-github-token',
      linearApiKey: 'env-linear-token'
    });

    const response = await request('GET', `/api/integrations/status?workspaceId=${workspace.id}`);
    const github = response.body.integrations.find((integration: any) => integration.provider === 'github');
    const linear = response.body.integrations.find((integration: any) => integration.provider === 'linear');

    expect(response.status).toBe(200);
    expect(github).toEqual(expect.objectContaining({
      status: 'connected',
      source: 'env',
      envKey: 'GITHUB_PAT'
    }));
    expect(linear).toEqual(expect.objectContaining({
      status: 'connected',
      source: 'env',
      envKey: 'LINEAR_API_KEY'
    }));
  });

  it('rejects personal-only integration connects in Murph runtime', async () => {
    const { request, workspace } = await setup({ distribution: 'team' });

    const response = await request('POST', '/api/integrations/obsidian/connect', {
      workspaceId: workspace.id,
      vaultPath: '/tmp/example-vault'
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('unsupported_provider');
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
    const { readSecret } = await import('#app/server/credentials/local-store');
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
    const { readSecretRecord } = await import('#app/server/credentials/local-store');
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

  it('surfaces plugin-provided integrations in status after plugin reload', async () => {
    const { request, workspace, murphHome } = await setup();
    writeZendeskPlugin(murphHome);

    const { reloadScopedPlugins } = await import('#app/server/plugins/loader');
    const pluginStatuses = await reloadScopedPlugins();
    const response = await request('GET', `/api/integrations/status?workspaceId=${workspace.id}`);
    const zendesk = response.body.integrations.find((integration: any) => integration.provider === 'zendesk');

    expect(pluginStatuses).toEqual([
      expect.objectContaining({
        id: 'zendesk',
        status: 'loaded',
        capabilities: expect.objectContaining({
          integrations: ['zendesk']
        })
      })
    ]);
    expect(response.status).toBe(200);
    expect(zendesk).toEqual(expect.objectContaining({
      provider: 'zendesk',
      name: 'Zendesk',
      description: 'Zendesk tickets and support context.',
      status: 'disconnected',
      authType: 'api_key',
      credentialLabel: 'Zendesk API key',
      envKey: 'ZENDESK_API_KEY',
      tools: ['zendesk.read_ticket'],
      contextSources: ['zendesk.thread_search']
    }));
  });

  it('validates, stores, and reports a Linear credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { viewer: { name: 'Murph Linear', email: 'linear@example.com' } } })
    });
    vi.stubGlobal('fetch', fetchMock);
    const { request, store, workspace } = await setup();

    const response = await request('POST', '/api/integrations/linear/connect', {
      workspaceId: workspace.id,
      credential: 'lin_api_key'
    });

    expect(response.status).toBe(200);
    expect(response.body.integration).toEqual(expect.objectContaining({
      provider: 'linear',
      status: 'connected',
      source: 'credentials',
      tools: ['linear.search_issues', 'linear.read_issue'],
      contextSources: ['linear.thread_search']
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'lin_api_key'
        })
      })
    );
    const { readSecret } = await import('#app/server/credentials/local-store');
    expect(readSecret('linear', 'api_key')).toBe('lin_api_key');
    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).toEqual(expect.arrayContaining(['linear.search_issues', 'linear.read_issue']));
    expect(memory.enabledContextSources).toContain('linear.thread_search');
  });

  it('reports global credentials before env fallback when both are present', async () => {
    const { request, store, workspace } = await setup({ githubPat: 'env-token' });
    const { writeSecret } = await import('#app/server/credentials/local-store');
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
    const { writeSecret } = await import('#app/server/credentials/local-store');
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

});
