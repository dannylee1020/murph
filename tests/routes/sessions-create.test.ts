import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type JsonResponse = {
  status: number;
  body: any;
};

function jsonRequest(body: unknown): any {
  const req = Readable.from([JSON.stringify(body)]) as any;
  req.method = 'POST';
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

async function setup(results: Array<{ channelId: string; name?: string; status: string; reason?: string }>) {
  vi.resetModules();
  process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-session-route-')), 'murph.sqlite');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  const ensureMember = vi.fn();
  for (const result of results) {
    ensureMember.mockResolvedValueOnce(result);
  }

  vi.doMock('#lib/server/runtime/bootstrap', () => ({
    ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
  }));
  vi.doMock('#lib/server/capabilities/channel-registry', () => ({
    getChannelRegistry: () => ({ ensureMember })
  }));

  const { getStore } = await import('#lib/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    slackTeamId: 'T1',
    name: 'Test Workspace',
    botTokenEncrypted: 'token',
    botUserId: 'UTZBOT'
  });
  const { gatewayRoutes } = await import('../../src/server/routes/gateway');
  const { dispatchRoute } = await import('../../src/server/router');

  async function post(body: unknown) {
    const req = jsonRequest(body);
    const res = jsonResponse();
    await dispatchRoute(gatewayRoutes, {
      req,
      res,
      url: new URL('/api/gateway/sessions', 'http://localhost')
    });
    return res.result();
  }

  return { post, store, workspace, ensureMember };
}

describe('POST /api/gateway/sessions channel membership gating', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a session when all scoped channels are already joined', async () => {
    const { post, store, workspace, ensureMember } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'already_member' }
    ]);

    const response = await post({
      ownerSlackUserId: 'UOWNER',
      channelScope: ['C1'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(201);
    expect(response.body.autoJoined).toEqual([]);
    expect(store.listActiveSessions(workspace.id)).toHaveLength(1);
    expect(ensureMember).toHaveBeenCalledWith(expect.objectContaining({ id: workspace.id }), 'slack', 'C1');
  });

  it('creates a session and reports auto-joined public channels', async () => {
    const { post, store, workspace } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'already_member' },
      { channelId: 'C2', name: 'launch', status: 'joined' }
    ]);

    const response = await post({
      ownerSlackUserId: 'UOWNER',
      channelScope: ['C1', 'C2'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(201);
    expect(response.body.autoJoined).toEqual([{ id: 'C2', name: 'launch' }]);
    expect(store.listActiveSessions(workspace.id)).toHaveLength(1);
  });

  it('blocks session creation when a scoped private channel requires invitation', async () => {
    const { post, store, workspace } = await setup([
      { channelId: 'G1', name: 'launch-war-room', status: 'requires_invitation' }
    ]);

    const response = await post({
      ownerSlackUserId: 'UOWNER',
      channelScope: ['G1'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      ok: false,
      error: 'channels_require_action',
      reinstallRequired: false,
      requiresInvitation: [
        {
          id: 'G1',
          name: 'launch-war-room',
          action: '/invite @TZBot in #launch-war-room'
        }
      ]
    });
    expect(store.listActiveSessions(workspace.id)).toHaveLength(0);
  });

  it('blocks session creation when Slack app reinstall is required', async () => {
    const { post, store, workspace } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'reinstall_required', reason: 'missing_scope' }
    ]);

    const response = await post({
      ownerSlackUserId: 'UOWNER',
      channelScope: ['C1'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(409);
    expect(response.body.reinstallRequired).toBe(true);
    expect(store.listActiveSessions(workspace.id)).toHaveLength(0);
  });

  it('persists a compiled user policy from the start-session request', async () => {
    const { post, store, workspace } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'already_member' }
    ]);

    const response = await post({
      ownerSlackUserId: 'UOWNER',
      channelScope: ['C1'],
      mode: 'manual_review',
      policyProfileName: 'founder-coverage',
      policyOverrideRaw: 'Block topics: payroll'
    });

    expect(response.status).toBe(201);
    const memory = store.getOrCreateUserMemory(workspace.id, 'UOWNER');
    const session = store.listActiveSessions(workspace.id)[0];
    expect(memory.policy?.profileName).toBe('founder-coverage');
    expect(memory.policy?.compiled.alwaysQueueTopics).toContain('launch decisions');
    expect(memory.policy?.compiled.blockedTopics).toContain('payroll');
    expect(memory.policy?.compiled.allowAutoSend).toBe(false);
    expect(session.policyProfileName).toBe('founder-coverage');
    expect(session.policy?.compiled.blockedTopics).toContain('payroll');
  });
});
