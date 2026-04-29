import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('SlackService searchMessages', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
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

    const { encryptString } = await import('#lib/server/util/crypto');
    const { getStore } = await import('#lib/server/persistence/store');
    const { getSlackService } = await import('#lib/server/channels/slack/service');
    const store = getStore();
    const workspace = store.saveInstall({
      slackTeamId: 'T1',
      name: 'Test Workspace',
      botTokenEncrypted: encryptString('xoxb-test-token', 'test-key'),
      botUserId: 'UBOT'
    });

    const slack = getSlackService();
    const results = await slack.searchMessages(workspace, 'launch timing', 3);

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
