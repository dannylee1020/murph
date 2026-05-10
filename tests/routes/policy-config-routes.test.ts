import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function jsonRequest(method: string, body?: unknown): any {
  const req = body === undefined ? Readable.from([]) as any : Readable.from([JSON.stringify(body)]) as any;
  req.method = method;
  req.headers = {};
  return req;
}

function jsonResponse(): any & { result: () => { status: number; body: any } } {
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

async function setup() {
  vi.resetModules();
  process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-policy-config-route-')), 'murph.sqlite');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  vi.doMock('#lib/server/runtime/bootstrap', () => ({
    ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
  }));

  const { getStore } = await import('#lib/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botTokenEncrypted: 'token',
    botUserId: 'UTZBOT'
  });
  store.upsertUser({ workspaceId: workspace.id, externalUserId: 'U1', displayName: 'Daniel' });
  const { gatewayRoutes } = await import('../../src/server/routes/gateway');
  const { dispatchRoute } = await import('../../src/server/router');

  async function request(method: string, path: string, body?: unknown) {
    const req = jsonRequest(method, body);
    const res = jsonResponse();
    await dispatchRoute(gatewayRoutes, {
      req,
      res,
      url: new URL(path, 'http://localhost')
    });
    return res.result();
  }

  return { request, store, workspace };
}

describe('policy configuration routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns local policy config with profiles and compiled fallback', async () => {
    const { request } = await setup();

    const response = await request('GET', '/api/gateway/policy/config');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.profiles.map((profile: { name: string }) => profile.name)).toEqual([
      'default',
      'engineering',
      'leadership',
      'marketing',
      'product',
      'sales'
    ]);
    expect(response.body.selectedProfileName).toBe('builtin-manual_review');
    expect(response.body.compiled.requireGroundingForFacts).toBe(true);
  });

  it('saves local policy profile selection', async () => {
    const { request, store } = await setup();

    const response = await request('PUT', '/api/gateway/policy/config', {
      profileName: 'product'
    });

    expect(response.status).toBe(200);
    expect(response.body.policyProfileName).toBe('product');
    expect(response.body.selectedProfileName).toBe('product');
    expect(store.getAppSettings().policyProfileName).toBe('product');
  });

  it('normalizes legacy policy profile selections', async () => {
    const { request, store } = await setup();

    const response = await request('PUT', '/api/gateway/policy/config', {
      profileName: 'founder-coverage'
    });

    expect(response.status).toBe(200);
    expect(response.body.policyProfileName).toBe('leadership');
    expect(response.body.selectedProfileName).toBe('leadership');
    expect(store.getAppSettings().policyProfileName).toBe('leadership');
  });

  it('rejects unknown local policy profile selection', async () => {
    const { request } = await setup();

    const response = await request('PUT', '/api/gateway/policy/config', {
      profileName: 'does-not-exist'
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('unknown_policy_profile');
  });
});
