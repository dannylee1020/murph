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
    expect(readSecret('github', 'api_key', { workspaceId: workspace.id })).toBe('ghp_test_token');
    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).toContain('github.search');
    expect(memory.enabledContextSources).toContain('github.thread_search');
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
    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).toContain('github.search');
    expect(memory.enabledContextSources).toContain('github.thread_search');
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
});
