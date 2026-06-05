import { beforeEach, describe, expect, it, vi } from 'vitest';

function encodeText(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

describe('GmailService', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('searches threads and reads thread content', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/threads?')) {
        return {
          ok: true,
          json: async () => ({
            threads: [{ id: 'thread-1' }]
          })
        };
      }

      return {
        ok: true,
        json: async () => ({
          id: 'thread-1',
          snippet: 'Follow-up on launch timeline',
          messages: [
            {
              id: 'msg-1',
              threadId: 'thread-1',
              internalDate: '1710000000000',
              snippet: 'Follow-up on launch timeline',
              payload: {
                headers: [
                  { name: 'Subject', value: 'Launch timeline' },
                  { name: 'From', value: 'founder@example.com' },
                  { name: 'To', value: 'team@example.com' }
                ],
                parts: [
                  {
                    mimeType: 'text/plain',
                    body: {
                      data: encodeText('We should confirm the launch date.')
                    }
                  }
                ]
              }
            }
          ]
        })
      };
    }));

    const { getGmailService, toArtifact } = await import('#app/server/context-sources/gmail');
    const gmail = getGmailService();
    const search = await gmail.search('google-token', 'launch timeline', 3);

    expect(search.results[0]).toEqual(expect.objectContaining({
      id: 'thread-1',
      subject: 'Launch timeline'
    }));
    expect(search.diagnostics.searchQueries).toContain('launch timeline');
    expect(toArtifact(search.results[0])).toEqual(expect.objectContaining({ source: 'gmail', type: 'email' }));
  });

});
