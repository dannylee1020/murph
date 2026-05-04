import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

describe('slack routes', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-slack-routes-')), 'murph.sqlite');
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  });

  it('returns available Slack channels for the installed workspace', async () => {
    const listChannels = vi.fn().mockResolvedValue([
      { id: 'C1', displayName: '#general', isMember: true, isPrivate: false },
      { id: 'C2', displayName: '#launch-war-room', isMember: true, isPrivate: true }
    ]);

    vi.doMock('#lib/server/channels/slack/service', () => ({
      getSlackService: () => ({
        listChannels
      })
    }));

    const { getStore } = await import('#lib/server/persistence/store');
    const store = getStore();
    store.saveInstall({
      slackTeamId: 'T1',
      name: 'Workspace',
      botTokenEncrypted: 'token',
      botUserId: 'UTZBOT'
    });

    const { slackRoutes } = await import('../../src/server/routes/slack');
    const { dispatchRoute } = await import('../../src/server/router');
    const res = jsonResponse();

    await dispatchRoute(slackRoutes, {
      req: { method: 'GET', headers: {} } as any,
      res,
      url: new URL('/api/slack/channels', 'http://localhost')
    });

    const result = res.result();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      channels: [
        { id: 'C1', displayName: '#general', isMember: true, isPrivate: false },
        { id: 'C2', displayName: '#launch-war-room', isMember: true, isPrivate: true }
      ]
    });
    expect(listChannels).toHaveBeenCalledOnce();
  });
});
