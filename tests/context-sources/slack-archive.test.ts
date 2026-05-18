import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('SlackService searchMessages', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
    process.env.MURPH_CREDENTIALS_PATH = join(mkdtempSync(join(tmpdir(), 'murph-slack-search-')), '.credentials');
  });

  it('searches Slack messages and normalizes thread retrieval results', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://slack.com/api/search.messages') {
        return {
          json: async () => ({
            ok: true,
            messages: {
              matches: [
                {
                  iid: 'msg-1',
                  channel: { id: 'C1', name: 'product' },
                  text: 'Launch timing looks good.',
                  ts: '1710000000.000100',
                  permalink: 'https://workspace.slack.com/archives/C1/p1710000000000100',
                  user: 'U123'
                }
              ]
            }
          })
        };
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getStore } = await import('#lib/server/persistence/store');
    const { getSlackService } = await import('#lib/server/channels/slack/service');
    const { writeSecret } = await import('#lib/server/credentials/local-store');
    const store = getStore();
    const workspace = store.saveInstall({
      provider: 'slack',
      externalWorkspaceId: 'T1',
      name: 'Test Workspace',
      botUserId: 'UBOT'
    });
    writeSecret('slack', 'user_search_token', 'xoxp-search-token', {
      workspaceId: workspace.id,
      externalWorkspaceId: workspace.externalWorkspaceId
    });

    const slack = getSlackService();
    const results = await slack.searchMessages(workspace, 'launch timing', 3);
    expect(fetchMock.mock.calls[0][1]?.headers.authorization).toBe('Bearer xoxp-search-token');

    expect(results).toEqual([
      {
        id: 'msg-1',
        channelId: 'C1',
        channelName: 'product',
        threadTs: '1710000000.000100',
        text: 'Launch timing looks good.',
        permalink: 'https://workspace.slack.com/archives/C1/p1710000000000100',
        userId: 'U123'
      }
    ]);
  });
});
