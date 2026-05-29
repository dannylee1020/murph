import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type JsonResponse = {
  status: number;
  body: any;
};

function jsonRequest(method: string, body?: unknown, token?: string): any {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
  req.method = method;
  req.headers = {
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
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

async function setup() {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-me-route-'));
  process.env.MURPH_APP_DIR = root;
  process.env.MURPH_HOME = root;
  process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';

  const { getStore } = await import('#shared/server/persistence/store');
  const {
    issueSubscriberDashboardToken,
    revokeSubscriberDashboardToken
  } = await import('#shared/server/auth/dashboard-access');
  const { meRoutes } = await import('../../app/team/runtime/routes/me');
  const { dispatchRoute } = await import('../../shared/server/router');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UBOT'
  });
  store.upsertWorkspaceSubscription({
    workspaceId: workspace.id,
    provider: 'slack',
    externalUserId: 'U1',
    displayName: 'User One',
    status: 'active',
    channelScopeMode: 'all_accessible',
    channelScope: []
  });
  store.upsertWorkspaceSubscription({
    workspaceId: workspace.id,
    provider: 'slack',
    externalUserId: 'U2',
    displayName: 'User Two',
    status: 'active',
    channelScopeMode: 'all_accessible',
    channelScope: []
  });
  const issued = issueSubscriberDashboardToken(workspace.id, 'U1', 'https://murph.test');

  async function request(method: string, path: string, token?: string, body?: unknown) {
    const req = jsonRequest(method, body, token);
    const res = jsonResponse();
    await dispatchRoute(meRoutes, {
      req,
      res,
      url: new URL(path, 'https://murph.test')
    });
    return res.result();
  }

  return { request, store, workspace, token: issued.token, issueSubscriberDashboardToken, revokeSubscriberDashboardToken };
}

describe('/api/me routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requires a valid subscriber dashboard token', async () => {
    const { request } = await setup();

    const response = await request('GET', '/api/me/bootstrap');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('subscriber_token_required');
  });

  it('scopes queue and run data to the authenticated subscriber', async () => {
    const { request, store, workspace, token } = await setup();
    const ownItem = store.insertAction({
      workspaceId: workspace.id,
      channelId: 'C1',
      threadTs: '111.222',
      targetUserId: 'U1',
      actionType: 'reply',
      disposition: 'queued',
      message: 'Own draft',
      reason: 'Needs approval',
      confidence: 0.8
    });
    store.insertAction({
      workspaceId: workspace.id,
      channelId: 'C1',
      threadTs: '333.444',
      targetUserId: 'U2',
      actionType: 'reply',
      disposition: 'queued',
      message: 'Other draft',
      reason: 'Needs approval',
      confidence: 0.8
    });
    const ownRun = store.createAgentRun({
      workspaceId: workspace.id,
      taskId: 'task-1',
      channelId: 'C1',
      threadTs: '111.222',
      targetUserId: 'U1'
    });
    store.appendAgentRunEvent({ runId: ownRun.id, type: 'agent.run.started', payload: { ok: true } });
    const otherRun = store.createAgentRun({
      workspaceId: workspace.id,
      taskId: 'task-2',
      channelId: 'C1',
      threadTs: '333.444',
      targetUserId: 'U2'
    });
    store.appendAgentRunEvent({ runId: otherRun.id, type: 'agent.run.started', payload: { ok: false } });

    const queue = await request('GET', '/api/me/queue', token);
    const runs = await request('GET', '/api/me/runs', token);
    const ownEvents = await request('GET', `/api/me/runs/${ownRun.id}/events`, token);
    const otherEvents = await request('GET', `/api/me/runs/${otherRun.id}/events`, token);

    expect(queue.body.queue).toEqual([expect.objectContaining({ id: ownItem.id, message: 'Own draft' })]);
    expect(runs.body.runs).toEqual([expect.objectContaining({ id: ownRun.id, targetUserId: 'U1' })]);
    expect(ownEvents.status).toBe(200);
    expect(ownEvents.body.events).toHaveLength(1);
    expect(otherEvents.status).toBe(404);
  });

  it('rejects a revoked subscriber dashboard token', async () => {
    const { request, workspace, token, revokeSubscriberDashboardToken } = await setup();

    revokeSubscriberDashboardToken(workspace.id, 'U1');
    const response = await request('GET', '/api/me/bootstrap', token);

    expect(response.status).toBe(401);
  });

  it('rejects the previous subscriber token after regeneration', async () => {
    const { request, workspace, token, issueSubscriberDashboardToken } = await setup();

    const next = issueSubscriberDashboardToken(workspace.id, 'U1', 'https://murph.test');
    const oldResponse = await request('GET', '/api/me/bootstrap', token);
    const nextResponse = await request('GET', '/api/me/bootstrap', next.token);

    expect(oldResponse.status).toBe(401);
    expect(nextResponse.status).toBe(200);
  });
});
