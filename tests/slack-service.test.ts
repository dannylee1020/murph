import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function setup() {
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), 'murph-slack-service-'));
  process.env.MURPH_SQLITE_PATH = join(dir, 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = join(dir, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';

  const { getStore } = await import('../app/server/persistence/store');
  const { writeSecret } = await import('../app/server/credentials/local-store');
  const { SlackService } = await import('../app/server/channels/slack/service');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UBOT'
  });
  writeSecret('slack', 'bot_token', 'xoxb-bot-token', {
    workspaceId: workspace.id,
    externalWorkspaceId: workspace.externalWorkspaceId
  });
  writeSecret('slack', 'user_search_token', 'xoxp-user-token', {
    workspaceId: workspace.id,
    externalWorkspaceId: workspace.externalWorkspaceId
  });
  return { service: new SlackService(), workspace };
}

describe('SlackService token routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the bot token for conversations.replies thread fetches', async () => {
    const { service, workspace } = await setup();
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        messages: [{ user: 'UASKER', text: 'status?', ts: '111.222' }]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    await service.fetchThreadMessages(workspace, { provider: 'slack', channelId: 'C1', threadTs: '111.222' });

    expect(fetchMock).toHaveBeenCalledWith('https://slack.com/api/conversations.replies', expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'Bearer xoxb-bot-token'
      })
    }));
  });

  it('uses the user search token for search.messages', async () => {
    const { service, workspace } = await setup();
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        messages: { matches: [] }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    await service.searchMessages(workspace, 'dark mode', 5);

    expect(fetchMock).toHaveBeenCalledWith('https://slack.com/api/search.messages', expect.objectContaining({
      headers: expect.objectContaining({
        authorization: 'Bearer xoxp-user-token'
      })
    }));
  });
});
