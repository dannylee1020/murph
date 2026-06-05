import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ChannelResult = { channelId: string; name?: string; status: string; reason?: string };

function jsonRequest(body: unknown, method = 'POST'): any {
  const req = Readable.from([JSON.stringify(body)]) as any;
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
      return { status, body: payload ? JSON.parse(payload) : undefined };
    }
  };
}

async function setup(results: ChannelResult[] = []) {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-session-route-'));
  process.env.MURPH_APP_DIR = root;
  process.env.MURPH_HOME = root;
  process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  delete process.env.MURPH_PRODUCT_MODE;

  const ensureMember = vi.fn();
  for (const result of results) {
    ensureMember.mockResolvedValueOnce(result);
  }

  vi.doMock('#app/server/runtime/bootstrap', () => ({
    ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
  }));
  vi.doMock('#app/server/capabilities/channel-registry', () => ({
    getChannelRegistry: () => ({
      ensureMember,
      getMember: vi.fn()
    })
  }));

  const { getStore } = await import('#app/server/persistence/store');
  const { writeSecret } = await import('#app/server/credentials/local-store');
  const { updateMurphSetupDefaults, updateMurphPolicyConfig } = await import('../../app/server/setup/config-file');
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
  updateMurphSetupDefaults({
    channelProvider: 'slack',
    workspaceId: workspace.id
  });

  const { gatewayRoutes } = await import('../../app/server/routes/gateway');
  const { dispatchRoute } = await import('../../app/server/router');

  async function post(body: unknown, path = '/api/gateway/sessions') {
    const req = jsonRequest(body);
    const res = jsonResponse();
    await dispatchRoute(gatewayRoutes, {
      req,
      res,
      url: new URL(path, 'http://localhost')
    });
    return res.result();
  }

  return { post, store, workspace, ensureMember, updateMurphPolicyConfig };
}

describe('POST /api/gateway/sessions', () => {
  const envKeys = [
    'MURPH_APP_DIR',
    'MURPH_HOME',
    'MURPH_CONFIG_PATH',
    'MURPH_SQLITE_PATH',
    'MURPH_CREDENTIALS_PATH',
    'MURPH_ENCRYPTION_KEY',
    'MURPH_PRODUCT_MODE'
  ] as const;
  const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

  function restoreEnv() {
    for (const key of envKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('#app/server/runtime/bootstrap');
    vi.doUnmock('#app/server/capabilities/channel-registry');
    vi.resetModules();
    vi.useRealTimers();
    restoreEnv();
  });

  afterEach(() => {
    vi.doUnmock('#app/server/runtime/bootstrap');
    vi.doUnmock('#app/server/capabilities/channel-registry');
    vi.resetModules();
    vi.useRealTimers();
    restoreEnv();
  });

  it('creates ownerless team sessions scoped to selected channels', async () => {
    const { post, store, workspace, ensureMember } = await setup([
      { channelId: 'C1', name: 'support', status: 'already_member' }
    ]);

    const response = await post({
      workspaceId: workspace.id,
      channelScope: ['C1'],
      durationHours: 2
    });

    expect(response.status).toBe(201);
    expect(ensureMember).toHaveBeenCalledWith(workspace, 'slack', 'C1');
    const session = store.listActiveSessions(workspace.id)[0];
    expect(session).toMatchObject({
      ownerUserId: undefined,
      title: 'Murph agent',
      mode: 'manual_review',
      channelScope: ['C1']
    });
  });

  it('reports public channels the bot auto-joined', async () => {
    const { post, workspace } = await setup([
      { channelId: 'C1', name: 'support', status: 'joined' }
    ]);

    const response = await post({
      workspaceId: workspace.id,
      channelScope: ['C1']
    });

    expect(response.status).toBe(201);
    expect(response.body.autoJoined).toEqual([{ id: 'C1', name: 'support' }]);
  });

  it('rejects sessions when channels require manual action', async () => {
    const { post, store, workspace } = await setup([
      { channelId: 'C1', name: 'private-support', status: 'requires_invitation' }
    ]);

    const response = await post({
      workspaceId: workspace.id,
      channelScope: ['C1']
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      ok: false,
      error: 'channels_require_action',
      requiresInvitation: [{ id: 'C1', name: 'private-support' }]
    });
    expect(store.listActiveSessions(workspace.id)).toHaveLength(0);
  });

  it('snapshots the global team policy for new sessions', async () => {
    const { post, store, workspace, updateMurphPolicyConfig } = await setup([
      { channelId: 'C1', name: 'support', status: 'already_member' }
    ]);
    updateMurphPolicyConfig({ profileName: 'investor' });

    const response = await post({
      workspaceId: workspace.id,
      channelScope: ['C1'],
      mode: 'auto_send_low_risk'
    });

    expect(response.status).toBe(201);
    const session = store.listActiveSessions(workspace.id)[0];
    expect(session.ownerUserId).toBeUndefined();
    expect(session.mode).toBe('manual_review');
    expect(session.policyProfileName).toBe('investor');
    expect(session.policy?.compiled.alwaysQueueTopics).toContain('investor updates');
    expect(session.policy?.compiled.allowAutoSend).toBe(false);
  });
});
