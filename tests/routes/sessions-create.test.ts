import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type JsonResponse = {
  status: number;
  body: any;
};

function jsonRequest(body: unknown, method = 'POST'): any {
  const req = Readable.from([JSON.stringify(body)]) as any;
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

async function setup(
  results: Array<{ channelId: string; name?: string; status: string; reason?: string }>,
  input: { productMode?: 'personal' | 'channel' } = {}
) {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-session-route-'));
  process.env.MURPH_APP_DIR = root;
  process.env.MURPH_HOME = root;
  process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  if (input.productMode) {
    process.env.MURPH_PRODUCT_MODE = input.productMode;
  } else {
    delete process.env.MURPH_PRODUCT_MODE;
  }
  const ensureMember = vi.fn();
  const getMember = vi.fn(async (_workspace: unknown, userId: string) => ({
    id: userId,
    displayName: userId
  }));
  for (const result of results) {
    ensureMember.mockResolvedValueOnce(result);
  }

  vi.doMock('#lib/server/runtime/bootstrap', () => ({
    ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
  }));
  vi.doMock('#lib/server/capabilities/channel-registry', () => ({
    getChannelRegistry: () => ({ ensureMember, getMember })
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
  const discordWorkspace = store.saveInstall({
    provider: 'discord',
    externalWorkspaceId: 'G1',
    name: 'Test Guild',
    botUserId: 'DBOT'
  });
  writeSecret('slack', 'bot_token', 'xoxb-test', {
    workspaceId: workspace.id,
    externalWorkspaceId: workspace.externalWorkspaceId
  });
  store.upsertWorkspaceSubscription({
    workspaceId: workspace.id,
    provider: 'slack',
    externalUserId: 'UOWNER',
    displayName: 'Owner',
    status: 'active',
    channelScopeMode: 'all_accessible',
    channelScope: []
  });
  store.upsertWorkspaceSubscription({
    workspaceId: discordWorkspace.id,
    provider: 'discord',
    externalUserId: '1234567890',
    displayName: 'Discord Owner',
    status: 'active',
    channelScopeMode: 'all_accessible',
    channelScope: []
  });
  const { updateMurphSetupDefaults } = await import('../../src/lib/server/setup/config-file');
  updateMurphSetupDefaults({
    channelProvider: 'slack',
    workspaceId: workspace.id,
    ownerUserId: 'UOWNER',
    ownerDisplayName: 'Owner',
    workspaceOwners: [
      { workspaceId: workspace.id, ownerUserId: 'UOWNER', ownerDisplayName: 'Owner' },
      { workspaceId: discordWorkspace.id, ownerUserId: '1234567890', ownerDisplayName: 'Discord Owner' }
    ]
  });
  const { gatewayRoutes } = await import('../../src/server/routes/gateway');
  const { dispatchRoute } = await import('../../src/server/router');
  const { getGateway } = await import('../../src/lib/server/runtime/gateway');

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

  async function put(body: unknown, path: string) {
    const req = jsonRequest(body, 'PUT');
    const res = jsonResponse();
    await dispatchRoute(gatewayRoutes, {
      req,
      res,
      url: new URL(path, 'http://localhost')
    });
    return res.result();
  }

  return { post, put, store, workspace, discordWorkspace, gateway: getGateway(), ensureMember, getMember };
}

describe('POST /api/gateway/sessions channel membership gating', () => {
  const originalMurphHome = process.env.MURPH_HOME;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (originalMurphHome === undefined) {
      delete process.env.MURPH_HOME;
    } else {
      process.env.MURPH_HOME = originalMurphHome;
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalMurphHome === undefined) {
      delete process.env.MURPH_HOME;
    } else {
      process.env.MURPH_HOME = originalMurphHome;
    }
  });

  it('creates a session and reports auto-joined public channels', async () => {
    const { post, store, workspace, gateway } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'already_member' },
      { channelId: 'C2', name: 'launch', status: 'joined' }
    ]);

    const response = await post({
      ownerUserId: 'UOWNER',
      channelScope: ['C1', 'C2'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(201);
    expect(response.body.autoJoined).toEqual([{ id: 'C2', name: 'launch' }]);
    expect(store.listActiveSessions(workspace.id)).toHaveLength(1);
  });

  it('allows watched channel sessions while a personal bot is also configured', async () => {
    const { post, store, workspace } = await setup([
      { channelId: 'C1', name: 'general', status: 'already_member' }
    ], { productMode: 'personal' });

    const response = await post({
      ownerUserId: 'UOWNER',
      channelScope: ['C1'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(201);
    expect(store.listActiveSessions(workspace.id)).toHaveLength(1);
  });

  it('starts selected-channel sessions from the saved subscription without refetching the owner from Slack', async () => {
    const { post, store, workspace, ensureMember, getMember } = await setup([
      { channelId: 'C1', name: 'general', status: 'already_member' }
    ]);
    store.upsertWorkspaceSubscription({
      workspaceId: workspace.id,
      provider: 'slack',
      externalUserId: 'UOWNER',
      displayName: 'Saved Owner',
      status: 'active',
      channelScopeMode: 'selected',
      channelScope: ['C1']
    });
    getMember.mockRejectedValueOnce(new Error('missing_scope'));

    const response = await post({
      ownerUserId: 'UOWNER',
      channelScope: ['C1'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(201);
    expect(getMember).not.toHaveBeenCalled();
    expect(ensureMember).toHaveBeenCalledWith(workspace, 'slack', 'C1');
    expect(store.getUser(workspace.id, 'UOWNER')?.displayName).toBe('Saved Owner');
  });

  it('starts bulk sessions for all-accessible subscriptions without per-channel membership checks', async () => {
    const { post, store, workspace, ensureMember } = await setup([]);

    const response = await post({
      ownerUserId: 'UOWNER',
      mode: 'manual_review',
      targets: [
        { workspaceId: workspace.id, ownerUserId: 'UOWNER', channelScope: [] }
      ]
    }, '/api/gateway/sessions/bulk');

    expect(response.status).toBe(201);
    expect(ensureMember).not.toHaveBeenCalled();
    expect(store.listActiveSessions(workspace.id)).toHaveLength(1);
  });

  it('blocks session creation when a scoped private channel requires invitation', async () => {
    const { post, store, workspace, gateway } = await setup([
      { channelId: 'G1', name: 'launch-war-room', status: 'requires_invitation' }
    ]);

    const response = await post({
      ownerUserId: 'UOWNER',
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
    const { post, store, workspace, gateway } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'reinstall_required', reason: 'missing_scope' }
    ]);

    const response = await post({
      ownerUserId: 'UOWNER',
      channelScope: ['C1'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(409);
    expect(response.body.reinstallRequired).toBe(true);
    expect(response.body.reinstallRequiredChannels).toEqual([
      { id: 'C1', name: 'product-eng', reason: 'missing_scope' }
    ]);
    expect(store.listActiveSessions(workspace.id)).toHaveLength(0);
  });

  it('revalidates channels even when stale workspace memory marks them confirmed', async () => {
    const { post, store, workspace, ensureMember } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'requires_invitation' }
    ]);
    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    memory.confirmedChannels = ['C1'];
    store.upsertWorkspaceMemory(memory);

    const response = await post({
      ownerUserId: 'UOWNER',
      channelScope: ['C1'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(409);
    expect(ensureMember).toHaveBeenCalledWith(workspace, 'slack', 'C1');
    expect(store.getOrCreateWorkspaceMemory(workspace.id).confirmedChannels).toEqual([]);
    expect(store.listActiveSessions(workspace.id)).toHaveLength(0);
  });

  it('uses the local policy setting for new session snapshots', async () => {
    const { post, store, workspace } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'already_member' }
    ]);

    store.upsertAppSettings({ policyProfileName: 'investor' });

    const response = await post({
      ownerUserId: 'UOWNER',
      channelScope: ['C1'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(201);
    const memory = store.getOrCreateUserMemory(workspace.id, 'UOWNER');
    const session = store.listActiveSessions(workspace.id)[0];
    expect('policy' in memory).toBe(false);
    expect(session.policyProfileName).toBe('investor');
    expect(session.policy?.compiled.alwaysQueueTopics).toContain('company commitments');
    expect(session.policy?.compiled.allowAutoSend).toBe(false);
  });

  it('inherits auto-send mode from the durable policy config when mode is omitted', async () => {
    const { post, store, workspace } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'already_member' }
    ]);
    const { updateMurphPolicyConfig } = await import('../../src/lib/server/setup/config-file');
    updateMurphPolicyConfig({ profileName: 'yolo', mode: 'auto_send_low_risk' });

    const response = await post({
      ownerUserId: 'UOWNER',
      channelScope: ['C1']
    });

    expect(response.status).toBe(201);
    const session = store.listActiveSessions(workspace.id)[0];
    expect(session.mode).toBe('auto_send_low_risk');
    expect(session.policyProfileName).toBe('yolo');
    expect(session.policy?.compiled.executionMode).toBe('auto_send_low_risk');
  });

  it('does not let session mode increase autonomy beyond policy mode', async () => {
    const { post, store, workspace } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'already_member' }
    ]);
    const { updateMurphPolicyConfig } = await import('../../src/lib/server/setup/config-file');
    updateMurphPolicyConfig({ profileName: 'default', mode: 'manual_review' });

    const response = await post({
      ownerUserId: 'UOWNER',
      channelScope: ['C1'],
      mode: 'auto_send_low_risk'
    });

    expect(response.status).toBe(201);
    const session = store.listActiveSessions(workspace.id)[0];
    expect(session.mode).toBe('manual_review');
    expect(session.policy?.compiled.executionMode).toBe('manual_review');
  });

  it('computes timezone-aware session stop time on the server', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T07:30:00.000Z'));
    const { post, store, workspace, gateway } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'already_member' }
    ]);

    store.upsertUser({
      workspaceId: workspace.id,
      externalUserId: 'UOWNER',
      displayName: 'Owner',
      timezone: 'America/Los_Angeles',
      workdayStartHour: 9,
      workdayEndHour: 17
    });

    const response = await post({
      ownerUserId: 'UOWNER',
      channelScope: ['C1'],
      mode: 'manual_review',
      stopLocalTime: '09:00',
      timezone: 'America/Los_Angeles'
    });

    expect(response.status).toBe(201);
    expect(response.body.session.endsAt).toBe('2026-05-19T16:00:00.000Z');
    expect(store.getSessionById(response.body.session.id)?.status).toBe('active');
    await vi.advanceTimersByTimeAsync(8.5 * 60 * 60 * 1000);
    gateway.reconcileSessionExpirations();
    expect(store.getSessionById(response.body.session.id)?.status).toBe('expired');
    expect(store.getUser(workspace.id, 'UOWNER')?.schedule).toEqual({
      timezone: 'America/Los_Angeles',
      workdayStartHour: 9,
      workdayEndHour: 17
    });
  });

  it('requires target-specific owner IDs for coordinated sessions', async () => {
    const { post, store, workspace, discordWorkspace } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'already_member' },
      { channelId: 'D1', name: 'support', status: 'already_member' }
    ]);

    const response = await post({
      ownerUserId: 'UOWNER',
      mode: 'manual_review',
      targets: [
        { workspaceId: workspace.id, channelScope: ['C1'] },
        { workspaceId: discordWorkspace.id, channelScope: ['D1'] }
      ]
    }, '/api/gateway/sessions/bulk');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      ok: false,
      error: 'session_targets_failed',
      targets: expect.arrayContaining([
        expect.objectContaining({ error: 'owner_required' })
      ])
    });
    expect(store.listActiveSessions(workspace.id)).toHaveLength(0);
    expect(store.listActiveSessions(discordWorkspace.id)).toHaveLength(0);
  });

  it('uses target-specific owner IDs for coordinated sessions', async () => {
    const { post, store, workspace, discordWorkspace } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'already_member' },
      { channelId: 'D1', name: 'support', status: 'already_member' }
    ]);

    const response = await post({
      ownerUserId: 'UOWNER',
      mode: 'manual_review',
      targets: [
        { workspaceId: workspace.id, ownerUserId: 'UOWNER', channelScope: ['C1'] },
        { workspaceId: discordWorkspace.id, ownerUserId: '1234567890', channelScope: ['D1'] }
      ]
    }, '/api/gateway/sessions/bulk');

    expect(response.status).toBe(201);
    expect(store.listActiveSessions(workspace.id)[0].ownerUserId).toBe('UOWNER');
    expect(store.listActiveSessions(discordWorkspace.id)[0].ownerUserId).toBe('1234567890');
  });

  it('rejects an owner ID without an active subscription for the target workspace', async () => {
    const { post, store, workspace, discordWorkspace } = await setup([
      { channelId: 'D1', name: 'support', status: 'already_member' }
    ]);

    const response = await post({
      mode: 'manual_review',
      targets: [
        { workspaceId: discordWorkspace.id, ownerUserId: 'UOWNER', channelScope: ['D1'] }
      ]
    }, '/api/gateway/sessions/bulk');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      ok: false,
      error: 'session_targets_failed',
      targets: [
        expect.objectContaining({
          error: 'subscription_required',
          workspace: expect.objectContaining({ provider: 'discord' }),
          ownerUserId: 'UOWNER'
        })
      ]
    });
    expect(store.listActiveSessions(workspace.id)).toHaveLength(0);
    expect(store.listActiveSessions(discordWorkspace.id)).toHaveLength(0);
  });

  it('requires an active subscription before creating a session', async () => {
    const { post, store, workspace } = await setup([]);

    const response = await post({
      ownerUserId: 'UNSUBSCRIBED',
      channelScope: ['C1'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      ok: false,
      error: 'subscription_required',
      ownerUserId: 'UNSUBSCRIBED'
    });
    expect(store.listActiveSessions(workspace.id)).toHaveLength(0);
  });

  it('rejects paused subscriptions when creating a session', async () => {
    const { post, store, workspace } = await setup([]);
    store.upsertWorkspaceSubscription({
      workspaceId: workspace.id,
      provider: 'slack',
      externalUserId: 'UPAUSED',
      displayName: 'Paused Subscriber',
      status: 'paused',
      channelScopeMode: 'all_accessible',
      channelScope: []
    });

    const response = await post({
      ownerUserId: 'UPAUSED',
      channelScope: ['C1'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      ok: false,
      error: 'subscription_required',
      ownerUserId: 'UPAUSED'
    });
    expect(store.listActiveSessions(workspace.id)).toHaveLength(0);
  });

  it('lets an active subscribed non-owner create a session for allowed channels', async () => {
    const { post, store, workspace } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'already_member' }
    ]);
    store.upsertWorkspaceSubscription({
      workspaceId: workspace.id,
      provider: 'slack',
      externalUserId: 'UTEAM',
      displayName: 'Team Subscriber',
      status: 'active',
      channelScopeMode: 'selected',
      channelScope: ['C1']
    });

    const response = await post({
      ownerUserId: 'UTEAM',
      channelScope: ['C1'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(201);
    expect(store.listActiveSessions(workspace.id)[0]).toEqual(expect.objectContaining({
      ownerUserId: 'UTEAM',
      channelScope: ['C1']
    }));
  });

  it('blocks an active subscribed non-owner from creating a session outside selected channels', async () => {
    const { post, store, workspace, ensureMember } = await setup([]);
    store.upsertWorkspaceSubscription({
      workspaceId: workspace.id,
      provider: 'slack',
      externalUserId: 'UTEAM',
      displayName: 'Team Subscriber',
      status: 'active',
      channelScopeMode: 'selected',
      channelScope: ['C1']
    });

    const response = await post({
      ownerUserId: 'UTEAM',
      channelScope: ['C2'],
      mode: 'manual_review'
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      ok: false,
      error: 'subscription_channel_scope_mismatch',
      ownerUserId: 'UTEAM',
      channelScope: ['C2']
    });
    expect(ensureMember).not.toHaveBeenCalled();
    expect(store.listActiveSessions(workspace.id)).toHaveLength(0);
  });

  it('updates schedules only for active subscribers', async () => {
    const { put, store, workspace } = await setup([]);

    const response = await put({
      workspaceId: workspace.id,
      timezone: 'America/New_York',
      workdayStartHour: 10,
      workdayEndHour: 18
    }, '/api/gateway/users/UOWNER/schedule');

    expect(response.status).toBe(200);
    expect(store.getUser(workspace.id, 'UOWNER')?.schedule).toEqual({
      timezone: 'America/New_York',
      workdayStartHour: 10,
      workdayEndHour: 18
    });
    expect(store.getWorkspaceSubscription(workspace.id, 'UOWNER')?.schedule).toEqual({
      timezone: 'America/New_York',
      workdayStartHour: 10,
      workdayEndHour: 18
    });
  });

  it('defaults new subscriptions to all accessible channels when scope is omitted', async () => {
    const { put, store, workspace } = await setup([]);

    const response = await put({
      workspaceId: workspace.id,
      displayName: 'Team Subscriber'
    }, '/api/gateway/subscriptions/UTEAM');

    expect(response.status).toBe(200);
    expect(response.body.subscription).toEqual(expect.objectContaining({
      externalUserId: 'UTEAM',
      status: 'active',
      channelScopeMode: 'all_accessible',
      channelScope: []
    }));
    expect(store.getWorkspaceSubscription(workspace.id, 'UTEAM')).toEqual(expect.objectContaining({
      channelScopeMode: 'all_accessible',
      channelScope: []
    }));
  });

  it('rejects selected subscriptions without at least one channel', async () => {
    const { put, store, workspace } = await setup([]);

    const response = await put({
      workspaceId: workspace.id,
      channelScopeMode: 'selected',
      channelScope: []
    }, '/api/gateway/subscriptions/UTEAM');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      ok: false,
      error: 'subscription_channel_scope_required',
      ownerUserId: 'UTEAM'
    });
    expect(store.getWorkspaceSubscription(workspace.id, 'UTEAM')).toBeUndefined();
  });

  it('rejects schedule updates for users without an active subscription', async () => {
    const { put, store, workspace } = await setup([]);

    const response = await put({
      workspaceId: workspace.id,
      timezone: 'America/New_York',
      workdayStartHour: 10,
      workdayEndHour: 18
    }, '/api/gateway/users/UNSUBSCRIBED/schedule');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      ok: false,
      error: 'subscription_required',
      ownerUserId: 'UNSUBSCRIBED'
    });
    expect(store.getUser(workspace.id, 'UNSUBSCRIBED')).toBeUndefined();
  });

  it('returns workspace-specific failures for bulk session channel checks', async () => {
    const { post, store, workspace, discordWorkspace } = await setup([
      { channelId: 'C1', name: 'product-eng', status: 'already_member' },
      { channelId: 'D1', name: 'private-support', status: 'requires_invitation' }
    ]);

    const response = await post({
      ownerUserId: 'UOWNER',
      mode: 'manual_review',
      targets: [
        { workspaceId: workspace.id, ownerUserId: 'UOWNER', channelScope: ['C1'] },
        { workspaceId: discordWorkspace.id, ownerUserId: '1234567890', channelScope: ['D1'] }
      ]
    }, '/api/gateway/sessions/bulk');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      ok: false,
      error: 'channels_require_action',
      targets: [
        {
          workspace: expect.objectContaining({ provider: 'discord', name: 'Test Guild' }),
          requiresInvitation: [
            expect.objectContaining({ id: 'D1', name: 'private-support' })
          ]
        }
      ]
    });
    expect(store.listActiveSessions(workspace.id)).toHaveLength(0);
    expect(store.listActiveSessions(discordWorkspace.id)).toHaveLength(0);
  });
});
