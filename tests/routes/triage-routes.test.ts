import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type JsonResponse = {
  status: number;
  body: any;
};

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

async function setup() {
  vi.resetModules();
  process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-triage-route-')), 'murph.sqlite');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';

  const { getStore } = await import('#lib/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    slackTeamId: 'T1',
    name: 'Test Workspace',
    botTokenEncrypted: 'token',
    botUserId: 'UTZBOT'
  });
  const older = store.createSession({
    workspaceId: workspace.id,
    ownerSlackUserId: 'UOWNER',
    title: 'Older coverage',
    mode: 'manual_review',
    channelScope: ['C1'],
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  store.stopSession(older.id);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const latest = store.createSession({
    workspaceId: workspace.id,
    ownerSlackUserId: 'UOWNER',
    title: 'Latest coverage',
    mode: 'auto_send_low_risk',
    channelScope: ['C1'],
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  store.stopSession(latest.id);

  store.insertAction({
    workspaceId: workspace.id,
    sessionId: older.id,
    channelId: 'C1',
    threadTs: '111.111',
    targetUserId: 'UOWNER',
    actionType: 'reply',
    disposition: 'auto_sent',
    message: 'Older reply',
    reason: 'Older reason',
    confidence: 0.9,
    contextSnapshot: {
      summary: 'Older summary',
      continuityCase: 'clarification',
      thread: { channelId: 'C1', threadTs: '111.111', messages: [] }
    }
  });
  store.insertAction({
    workspaceId: workspace.id,
    sessionId: latest.id,
    channelId: 'C2',
    threadTs: '222.222',
    targetUserId: 'UOWNER',
    actionType: 'abstain',
    disposition: 'abstained',
    message: '',
    reason: 'Latest reason',
    confidence: 0.7,
    contextSnapshot: {
      summary: 'Latest summary',
      continuityCase: 'unknown',
      thread: {
        channelId: 'C2',
        threadTs: '222.222',
        messages: [{ ts: '222.222', authorId: 'UASKER', text: 'Can Murph help?' }]
      }
    }
  });

  const { gatewayRoutes } = await import('../../src/server/routes/gateway');
  const { dispatchRoute } = await import('../../src/server/router');

  async function get(path: string) {
    const res = jsonResponse();
    await dispatchRoute(gatewayRoutes, {
      req: { method: 'GET', headers: {}, on: vi.fn() } as any,
      res,
      url: new URL(path, 'http://localhost')
    });
    return res.result();
  }

  return { get, latest, older };
}

describe('GET /api/gateway/triage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to the latest completed session', async () => {
    const { get, latest } = await setup();

    const response = await get('/api/gateway/triage');

    expect(response.status).toBe(200);
    expect(response.body.session.id).toBe(latest.id);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].contextSnapshot.summary).toBe('Latest summary');
    expect(response.body.sessions.map((session: any) => session.id)).toContain(latest.id);
  });

  it('scopes triage items to an explicit session id', async () => {
    const { get, older } = await setup();

    const response = await get(`/api/gateway/triage?sessionId=${older.id}`);

    expect(response.status).toBe(200);
    expect(response.body.session.id).toBe(older.id);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].contextSnapshot.summary).toBe('Older summary');
  });
});
