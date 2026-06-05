import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function request(method: string, body?: unknown): any {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
  req.method = method;
  req.headers = {};
  return req;
}

function response(): any & { result: () => { status: number; body: any } } {
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
  const root = mkdtempSync(join(tmpdir(), 'murph-channel-routes-'));
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
  process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.OPENAI_API_KEY = 'sk-test';
  vi.doMock('#app/server/runtime/bootstrap', () => ({
    ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
  }));

  const { getStore } = await import('#app/server/persistence/store');
  const { getChannelRegistry } = await import('#app/server/capabilities/channel-registry');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'fixture',
    externalWorkspaceId: 'W1',
    name: 'Fixture Workspace',
    botUserId: 'BOT'
  });
  getChannelRegistry().registerPlugin({
    id: 'fixture',
    displayName: 'Fixture',
    runtime: {
      id: 'fixture',
      displayName: 'Fixture',
      capabilities: ['event_ingress', 'thread_fetch', 'reply_post'],
      normalizeEvent() {
        return null;
      },
      async fetchThread() {
        return [];
      },
      async postReply() {}
    },
    setup: {
      getStatus() {
        return { configured: true, installed: true };
      },
      async listMembers() {
        return [{ id: 'U1', displayName: 'User One' }];
      },
      async getMember(_workspace, userId) {
        return { id: userId, displayName: 'User One' };
      },
      async listChannels() {
        return [{ id: 'C1', displayName: '#general' }];
      },
      async getChannel(_workspace, channelId) {
        return { id: channelId, displayName: '#general' };
      }
    }
  }, { source: 'plugin' });

  const { channelRoutes } = await import('../../app/server/routes/channels');
  const { dispatchRoute } = await import('../../app/server/router');

  async function call(method: string, path: string, body?: unknown) {
    const res = response();
    await dispatchRoute(channelRoutes, {
      req: request(method, body),
      res,
      url: new URL(path, 'http://localhost')
    });
    return res.result();
  }

  return { call, workspace };
}

describe('channel routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.MURPH_SQLITE_PATH;
    delete process.env.MURPH_CONFIG_PATH;
    delete process.env.MURPH_CREDENTIALS_PATH;
    delete process.env.MURPH_ENCRYPTION_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it('lists providers and dispatches setup lookups through channel setup handlers', async () => {
    const { call, workspace } = await setup();

    expect((await call('GET', '/api/channels/providers')).body.providers).toEqual([
      expect.objectContaining({ id: 'fixture', source: 'plugin' })
    ]);
    expect((await call('GET', '/api/channels/fixture/members')).body.members).toEqual([
      { id: 'U1', displayName: 'User One' }
    ]);
    expect((await call('GET', `/api/channels/fixture/channels?workspaceId=${workspace.id}`)).body.channels).toEqual([
      { id: 'C1', displayName: '#general' }
    ]);
  });
});
