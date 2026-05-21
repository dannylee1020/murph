import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  if (options.githubPat) {
    process.env.GITHUB_PAT = options.githubPat;
  } else {
    process.env.GITHUB_PAT = '';
  }
  process.env.NOTION_API_KEY = '';
  process.env.GOOGLE_ACCESS_TOKEN = '';
  process.env.GOOGLE_CLIENT_ID = '';
  process.env.GOOGLE_CLIENT_SECRET = '';

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

  return { request, store, workspace };
}

describe('integration routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    expect(memory.enabledOptionalTools).toContain('github.search');
    expect(memory.enabledContextSources).toContain('github.thread_search');
    const discordMemory = store.getOrCreateWorkspaceMemory(discordWorkspace.id);
    expect(discordMemory.enabledOptionalTools).toContain('github.search');
    expect(discordMemory.enabledContextSources).toContain('github.thread_search');

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
