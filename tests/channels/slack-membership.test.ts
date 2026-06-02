import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function setup() {
  vi.resetModules();
  process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-slack-membership-')), 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = join(mkdtempSync(join(tmpdir(), 'murph-slack-membership-creds-')), '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.SLACK_CHANNEL_APP_ID = 'ASLACKCHANNEL';
  const { createSlackChannelAdapter } = await import('#shared/server/channels/slack/adapter');
  const { getStore } = await import('#shared/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  const channelInstallation = store.upsertBotInstallation({
    workspaceId: workspace.id,
    provider: 'slack',
    role: 'channel',
    appId: 'ASLACKCHANNEL',
    externalWorkspaceId: workspace.externalWorkspaceId,
    botUserId: 'UTZBOT'
  });
  const { writeSecret } = await import('#shared/server/credentials/local-store');
  writeSecret('slack', 'bot_token', 'xoxb-test', {
    workspaceId: workspace.id,
    externalWorkspaceId: workspace.externalWorkspaceId,
    botInstallationId: channelInstallation.id
  });

  return { adapter: createSlackChannelAdapter(), store, workspace, writeSecret };
}

function mockSlackResponses(...payloads: unknown[]) {
  const fetchMock = vi.fn();
  for (const payload of payloads) {
    fetchMock.mockResolvedValueOnce({
      json: async () => payload
    });
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Slack membership checks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('joins public channels when the bot is not a member', async () => {
    const { adapter, workspace } = await setup();
    const fetchMock = mockSlackResponses(
      { ok: true, channel: { id: 'C1', name: 'product-eng', is_member: false, is_private: false } },
      { ok: true }
    );

    await expect(adapter.ensureMember!(workspace, 'C1')).resolves.toMatchObject({
      channelId: 'C1',
      name: 'product-eng',
      status: 'joined'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requires invitation for private channels', async () => {
    const { adapter, workspace } = await setup();
    const fetchMock = mockSlackResponses({
      ok: true,
      channel: { id: 'G1', name: 'launch-war-room', is_member: false, is_private: true }
    });

    await expect(adapter.ensureMember!(workspace, 'G1')).resolves.toMatchObject({
      channelId: 'G1',
      name: 'launch-war-room',
      status: 'requires_invitation'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces reinstall-required when join scope is missing', async () => {
    const { adapter, workspace } = await setup();
    mockSlackResponses(
      { ok: true, channel: { id: 'C1', name: 'product-eng', is_member: false, is_private: false } },
      { ok: false, error: 'missing_scope' }
    );

    await expect(adapter.ensureMember!(workspace, 'C1')).resolves.toMatchObject({
      channelId: 'C1',
      name: 'product-eng',
      status: 'reinstall_required'
    });
  });

  it('uses the channel bot token for membership checks when a personal bot is also installed', async () => {
    const { adapter, store, workspace, writeSecret } = await setup();
    const personalInstallation = store.upsertBotInstallation({
      workspaceId: workspace.id,
      provider: 'slack',
      role: 'personal',
      externalWorkspaceId: workspace.externalWorkspaceId,
      botUserId: 'UPERSONAL',
      representedUserId: 'UOWNER'
    });
    writeSecret('slack', 'bot_token', 'xoxb-personal', {
      workspaceId: workspace.id,
      externalWorkspaceId: workspace.externalWorkspaceId,
      botInstallationId: personalInstallation.id
    });
    const fetchMock = mockSlackResponses({
      ok: true,
      channel: { id: 'C1', name: 'product-eng', is_member: true, is_private: false }
    });

    await expect(adapter.ensureMember!(workspace, 'C1')).resolves.toMatchObject({
      channelId: 'C1',
      status: 'already_member'
    });
    expect(fetchMock).toHaveBeenCalledWith('https://slack.com/api/conversations.info', expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'Bearer xoxb-test'
      })
    }));
  });

});
