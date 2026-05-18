import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonRequest(method: string, body?: unknown): any {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
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
  const workspaceDir = mkdtempSync(join(tmpdir(), 'murph-setup-defaults-route-'));
  process.env.MURPH_APP_DIR = workspaceDir;
  process.env.MURPH_SQLITE_PATH = join(workspaceDir, 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = join(workspaceDir, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SLACK_EVENTS_MODE = 'socket';
  process.env.SLACK_APP_TOKEN = 'xapp-test';
  process.env.SLACK_CLIENT_ID = 'client-id';
  process.env.SLACK_CLIENT_SECRET = 'client-secret';

  vi.doMock('#lib/server/runtime/bootstrap', () => ({
    ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
  }));

  const { getStore } = await import('#lib/server/persistence/store');
  const { writeSecret } = await import('#lib/server/credentials/local-store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  writeSecret('slack', 'bot_token', 'xoxb-test', {
    workspaceId: workspace.id,
    externalWorkspaceId: workspace.externalWorkspaceId
  });
  const { systemRoutes } = await import('../../src/server/routes/system');
  const { dispatchRoute } = await import('../../src/server/router');

  async function request(method: string, path: string, body?: unknown) {
    const req = jsonRequest(method, body);
    const res = jsonResponse();
    await dispatchRoute(systemRoutes, {
      req,
      res,
      url: new URL(path, 'http://localhost')
    });
    return res.result();
  }

  return { request, store, workspace };
}

describe('setup defaults routes', () => {
  const originalCwd = process.cwd();
  const originalAppDir = process.env.MURPH_APP_DIR;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    if (originalAppDir === undefined) {
      delete process.env.MURPH_APP_DIR;
    } else {
      process.env.MURPH_APP_DIR = originalAppDir;
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalAppDir === undefined) {
      delete process.env.MURPH_APP_DIR;
    } else {
      process.env.MURPH_APP_DIR = originalAppDir;
    }
  });

  it('saves owner, selected channels, and schedule as shared setup defaults', async () => {
    const { request, store, workspace } = await setup();

    const response = await request('PUT', '/api/setup/defaults', {
      ownerUserId: 'U1',
      ownerDisplayName: 'Daniel',
      channelScopeMode: 'selected',
      selectedChannels: [{ id: 'C1', displayName: '#product' }],
      timezone: 'America/Los_Angeles',
      workdayStartHour: 8,
      workdayEndHour: 16
    });

    expect(response.status).toBe(200);
    expect(response.body.defaults).toEqual(expect.objectContaining({
      ownerUserId: 'U1',
      ownerDisplayName: 'Daniel',
      channelScopeMode: 'selected',
      selectedChannels: [{ id: 'C1', displayName: '#product' }]
    }));
    expect(store.getUser(workspace.id, 'U1')?.schedule).toEqual({
      timezone: 'America/Los_Angeles',
      workdayStartHour: 8,
      workdayEndHour: 16
    });
    expect(store.getAppSettings().setupDefaults).toBeUndefined();
    expect(readFileSync(join(process.env.MURPH_APP_DIR!, 'murph.config.yaml'), 'utf8')).toContain('ownerUserId: U1');
    expect(readFileSync(join(process.env.MURPH_APP_DIR!, 'murph.config.yaml'), 'utf8')).toContain('displayName: "#product"');
  });

  it('marks setup ready only after identity and channels are configured', async () => {
    const { request } = await setup();

    const before = await request('GET', '/api/setup/doctor');
    expect(before.body.ready).toBe(false);
    expect(before.body.nextStep).toBe('identity');

    await request('PUT', '/api/setup/defaults', {
      ownerUserId: 'U1',
      ownerDisplayName: 'Daniel',
      channelScopeMode: 'all_accessible',
      timezone: 'America/Los_Angeles',
      workdayStartHour: 9,
      workdayEndHour: 17
    });

    const after = await request('GET', '/api/setup/doctor');
    expect(after.body.ready).toBe(true);
    expect(after.body.nextStep).toBe('ready');
  });
});
