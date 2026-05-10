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

    const { getGmailService, toArtifact } = await import('#lib/server/context-sources/gmail');
    const gmail = getGmailService();
    const search = await gmail.search('google-token', 'launch timeline', 3);

    expect(search.results[0]).toEqual(expect.objectContaining({
      id: 'thread-1',
      subject: 'Launch timeline'
    }));
    expect(search.diagnostics.searchQueries).toContain('launch timeline');
    expect(toArtifact(search.results[0])).toEqual(expect.objectContaining({ source: 'gmail', type: 'email' }));
  });

  it('broadens generic context requests and finds matching Gmail threads', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/threads') && parsed.searchParams.has('q')) {
        const query = parsed.searchParams.get('q');
        return {
          ok: true,
          json: async () => ({
            threads: query === 'Acme rate limiting' ? [{ id: 'acme-thread' }] : []
          })
        };
      }

      return {
        ok: true,
        json: async () => ({
          id: 'acme-thread',
          snippet: 'Acme Corp API rate limiting timeline check',
          messages: [
            {
              id: 'msg-1',
              threadId: 'acme-thread',
              internalDate: '1710000000000',
              snippet: 'Acme onboarding is locked in for June 2.',
              payload: {
                headers: [
                  { name: 'Subject', value: 'Re: Acme Corp API rate limiting - timeline check' },
                  { name: 'From', value: 'sarah@example.com' },
                  { name: 'To', value: 'team@example.com' }
                ],
                parts: [
                  {
                    mimeType: 'text/plain',
                    body: {
                      data: encodeText('Acme Corp onboarding is locked in for June 2. We need per-tenant sliding window rate limiting and 429 Retry-After.')
                    }
                  }
                ]
              }
            }
          ]
        })
      };
    }));

    const { getGmailService } = await import('#lib/server/context-sources/gmail');
    const gmail = getGmailService();
    const search = await gmail.search('google-token', 'Acme rate limiting timeline decided risks', 5);

    expect(search.results).toEqual([
      expect.objectContaining({
        id: 'acme-thread',
        subject: 'Re: Acme Corp API rate limiting - timeline check',
        text: expect.stringContaining('429 Retry-After')
      })
    ]);
    expect(search.diagnostics.searchQueries).toEqual([
      'Acme rate limiting timeline decided risks',
      'Acme rate limiting',
      'API rate limiting',
      'Acme Corp',
      'Acme onboarding'
    ]);
    expect(search.diagnostics.resultCounts['Acme rate limiting timeline decided risks']).toBe(0);
    expect(search.diagnostics.resultCounts['Acme rate limiting']).toBe(1);
  });

  it('dedupes thread IDs across query variants before reading', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/threads') && parsed.searchParams.has('q')) {
        const query = parsed.searchParams.get('q');
        return {
          ok: true,
          json: async () => ({
            threads: query === 'Acme rate limiting timeline decided risks' || query === 'Acme rate limiting'
              ? [{ id: 'acme-thread' }]
              : []
          })
        };
      }

      return {
        ok: true,
        json: async () => ({
          id: 'acme-thread',
          snippet: 'Acme Corp API rate limiting timeline check',
          messages: [
            {
              id: 'msg-1',
              threadId: 'acme-thread',
              internalDate: '1710000000000',
              payload: {
                headers: [
                  { name: 'Subject', value: 'Re: Acme Corp API rate limiting - timeline check' }
                ],
                parts: [
                  {
                    mimeType: 'text/plain',
                    body: {
                      data: encodeText('Acme rate limiting timeline.')
                    }
                  }
                ]
              }
            }
          ]
        })
      };
    }));

    const { getGmailService } = await import('#lib/server/context-sources/gmail');
    const gmail = getGmailService();
    const search = await gmail.search('google-token', 'Acme rate limiting timeline decided risks', 5);

    expect(search.results).toHaveLength(1);
    const readCalls = (fetch as any).mock.calls
      .map((call: any[]) => new URL(call[0]))
      .filter((url: URL) => url.pathname.endsWith('/threads/acme-thread'));
    expect(readCalls).toHaveLength(1);
  });
});
