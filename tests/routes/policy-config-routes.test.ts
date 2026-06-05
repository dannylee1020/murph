import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  const workspaceDir = mkdtempSync(join(tmpdir(), 'murph-policy-config-route-'));
  process.env.MURPH_APP_DIR = workspaceDir;
  process.env.MURPH_HOME = workspaceDir;
  process.env.MURPH_CONFIG_PATH = join(workspaceDir, 'config.yaml');
  process.env.MURPH_SQLITE_PATH = join(workspaceDir, 'murph.sqlite');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  vi.doMock('#app/server/runtime/bootstrap', () => ({
    ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
  }));

  const { getStore } = await import('#app/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  store.upsertUser({ workspaceId: workspace.id, externalUserId: 'U1', displayName: 'Daniel' });
  const { gatewayRoutes } = await import('../../app/server/routes/gateway');
  const { dispatchRoute } = await import('../../app/server/router');

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
  const originalCwd = process.cwd();
  const originalAppDir = process.env.MURPH_APP_DIR;
  const originalConfigPath = process.env.MURPH_CONFIG_PATH;
  const originalMurphHome = process.env.MURPH_HOME;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    if (originalAppDir === undefined) {
      delete process.env.MURPH_APP_DIR;
    } else {
      process.env.MURPH_APP_DIR = originalAppDir;
    }
    if (originalConfigPath === undefined) {
      delete process.env.MURPH_CONFIG_PATH;
    } else {
      process.env.MURPH_CONFIG_PATH = originalConfigPath;
    }
    if (originalMurphHome === undefined) {
      delete process.env.MURPH_HOME;
    } else {
      process.env.MURPH_HOME = originalMurphHome;
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalAppDir === undefined) {
      delete process.env.MURPH_APP_DIR;
    } else {
      process.env.MURPH_APP_DIR = originalAppDir;
    }
    if (originalConfigPath === undefined) {
      delete process.env.MURPH_CONFIG_PATH;
    } else {
      process.env.MURPH_CONFIG_PATH = originalConfigPath;
    }
    if (originalMurphHome === undefined) {
      delete process.env.MURPH_HOME;
    } else {
      process.env.MURPH_HOME = originalMurphHome;
    }
  });

  it('returns local policy config with profiles and compiled fallback', async () => {
    const { request } = await setup();

    const response = await request('GET', '/api/gateway/policy/config');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.profiles.map((profile: { name: string }) => profile.name)).toEqual(expect.arrayContaining([
      'default',
      'engineering',
      'investor',
      'product',
      'yolo'
    ]));
    expect(response.body.selectedProfileName).toBe('builtin-manual_review');
    expect(response.body.mode).toBe('manual_review');
    expect(response.body.compiled.executionMode).toBe('manual_review');
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
    expect(response.body.mode).toBe('manual_review');
    expect(store.getAppSettings().policyProfileName).toBeUndefined();
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('profile: product');
  });

  it('accepts the shipped yolo profile selection', async () => {
    const { request } = await setup();

    const response = await request('PUT', '/api/gateway/policy/config', {
      profileName: 'yolo'
    });

    expect(response.status).toBe(200);
    expect(response.body.policyProfileName).toBe('yolo');
    expect(response.body.selectedProfileName).toBe('yolo');
    expect(response.body.mode).toBe('auto_send_low_risk');
    expect(response.body.compiled).toEqual(expect.objectContaining({
      executionMode: 'auto_send_low_risk',
      allowAutoSend: true,
      requireGroundingForFacts: true,
      preferAskWhenUncertain: false
    }));
  });

  it('ignores deprecated durable policy mode input', async () => {
    const { request } = await setup();

    const response = await request('PUT', '/api/gateway/policy/config', {
      mode: 'auto_send_low_risk'
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe('manual_review');
    expect(response.body.compiled.executionMode).toBe('manual_review');
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).not.toContain('mode: auto_send_low_risk');
  });

  it('rejects unknown local policy profile selection', async () => {
    const { request } = await setup();

    const response = await request('PUT', '/api/gateway/policy/config', {
      profileName: 'does-not-exist'
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('unknown_policy_profile');
  });

  it('does not validate deprecated policy mode input', async () => {
    const { request } = await setup();

    const response = await request('PUT', '/api/gateway/policy/config', {
      mode: 'dry_run'
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe('manual_review');
  });
});
