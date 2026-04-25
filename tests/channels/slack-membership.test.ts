import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function setup() {
  vi.resetModules();
  process.env.NIGHTCLAW_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'nightclaw-slack-membership-')), 'nightclaw.sqlite');
  process.env.NIGHTCLAW_ENCRYPTION_KEY = 'test-key';
  const { encryptString } = await import('#lib/server/util/crypto');
  const { createSlackChannelAdapter } = await import('#lib/server/channels/slack/adapter');
  const { getStore } = await import('#lib/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    slackTeamId: 'T1',
    name: 'Test Workspace',
    botTokenEncrypted: encryptString('xoxb-test', 'test-key'),
    botUserId: 'UTZBOT'
  });

  return { adapter: createSlackChannelAdapter(), workspace };
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

  it('reports an existing public channel membership', async () => {
    const { adapter, workspace } = await setup();
    mockSlackResponses({ ok: true, channel: { id: 'C1', name: 'product-eng', is_member: true, is_private: false } });

    await expect(adapter.ensureMember!(workspace, 'C1')).resolves.toMatchObject({
      channelId: 'C1',
      name: 'product-eng',
      status: 'already_member'
    });
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

  it('surfaces channel lookup failures as errors', async () => {
    const { adapter, workspace } = await setup();
    mockSlackResponses({ ok: false, error: 'channel_not_found' });

    await expect(adapter.ensureMember!(workspace, 'C404')).resolves.toMatchObject({
      channelId: 'C404',
      status: 'error',
      reason: 'channel_not_found'
    });
  });
});
