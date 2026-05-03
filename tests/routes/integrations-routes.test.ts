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
  process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-integrations-route-')), 'murph.sqlite');
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
    slackTeamId: 'T1',
    name: 'Test Workspace',
    botTokenEncrypted: 'token',
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

  it('reports disconnected integrations for an installed workspace', async () => {
    const { request } = await setup();
    const response = await request('GET', '/api/integrations/status');

    expect(response.status).toBe(200);
    expect(response.body.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'github', status: 'disconnected' }),
        expect.objectContaining({ provider: 'notion', status: 'disconnected' })
      ])
    );
  });

  it('validates, encrypts, stores, and reports a GitHub credential', async () => {
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
        source: 'database',
        canDisconnect: true
      })
    );
    const stored = store.getIntegrationCredential(workspace.id, 'github');
    expect(stored?.credentialEncrypted).toBeTruthy();
    expect(stored?.credentialEncrypted).not.toBe('ghp_test_token');
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

  it('rejects invalid provider connects', async () => {
    const { request } = await setup();
    const response = await request('POST', '/api/integrations/unknown/connect', {
      credential: 'test-token'
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('unsupported_provider');
  });
});
