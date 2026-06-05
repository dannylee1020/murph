import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleTask = vi.fn();

vi.mock('#app/server/runtime/gateway', () => ({
  getGateway: () => ({ handleTask })
}));

function slackEvent(input: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: 'Ev1',
    team_id: 'T1',
    event: {
      type: 'app_mention',
      channel: 'C1',
      user: 'UASKER',
      text: '<@UTZBOT> can you confirm the launch spec?',
      ts: '111.222',
      ...input
    }
  };
}

async function setup() {
  const { getStore } = await import('../app/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });

  store.createSession({
    workspaceId: workspace.id,
    title: 'Team stakeholder coverage',
    mode: 'manual_review',
    channelScope: ['C1'],
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });

  return { store, workspace };
}

describe('handleSlackEventEnvelope', () => {
  beforeEach(() => {
    vi.resetModules();
    handleTask.mockReset();
    handleTask.mockResolvedValue({ disposition: 'queued' });
    const workspaceDir = mkdtempSync(join(tmpdir(), 'murph-slack-events-'));
    process.env.MURPH_CONFIG_PATH = join(workspaceDir, 'config.yaml');
    process.env.MURPH_SQLITE_PATH = join(workspaceDir, 'murph.sqlite');
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  });

  it('routes a valid Slack event through the shared gateway path', async () => {
    await setup();
    const { handleSlackEventEnvelope } = await import('../app/server/channels/slack/events');

    const result = await handleSlackEventEnvelope(slackEvent(), {
      rawPayload: JSON.stringify(slackEvent()),
      source: 'socket'
    });

    expect(result.ok).toBe(true);
    expect(result.taskId).toBeTruthy();
    expect(handleTask).toHaveBeenCalledOnce();
    expect(handleTask.mock.calls[0][0]).toMatchObject({
      source: 'slack_event',
      workspaceId: 'T1',
      thread: { provider: 'slack', channelId: 'C1', threadTs: '111.222' }
    });
    expect(handleTask.mock.calls[0][0].targetUserId).toBeUndefined();
  });

  it('dedupes repeated Slack events before dispatching to the gateway', async () => {
    await setup();
    const { handleSlackEventEnvelope } = await import('../app/server/channels/slack/events');

    await handleSlackEventEnvelope(slackEvent(), { source: 'socket' });
    const duplicate = await handleSlackEventEnvelope(slackEvent(), { source: 'http' });

    expect(duplicate).toMatchObject({ ok: true, ignored: true, reason: 'duplicate_event' });
    expect(handleTask).toHaveBeenCalledOnce();
  });

  it('dedupes app_mention and message deliveries for the same Slack message', async () => {
    await setup();
    const { handleSlackEventEnvelope } = await import('../app/server/channels/slack/events');

    await handleSlackEventEnvelope(slackEvent({ type: 'app_mention' }), { source: 'socket' });
    const duplicate = await handleSlackEventEnvelope(
      slackEvent({ type: 'message' }),
      { source: 'socket' }
    );

    expect(duplicate).toMatchObject({ ok: true, ignored: true, reason: 'duplicate_event' });
    expect(handleTask).toHaveBeenCalledOnce();
  });

  it('ignores Slack events when that bot role is turned off', async () => {
    await setup();
    const { getStore } = await import('../app/server/persistence/store');
    const store = getStore();
    store.upsertAppSettings({
      ...store.getAppSettings(),
      setupDefaults: { botRoles: ['channel'], providerBotRoles: { slack: [], discord: [] } }
    });
    const { handleSlackEventEnvelope } = await import('../app/server/channels/slack/events');

    const result = await handleSlackEventEnvelope(slackEvent(), { source: 'socket' });

    expect(result).toMatchObject({ ok: false, ignored: true, reason: 'bot_role_disabled' });
    expect(handleTask).not.toHaveBeenCalled();
  });
});
