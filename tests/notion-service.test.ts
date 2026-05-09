import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('NotionService search', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NOTION_API_KEY = 'test-key';
    process.env.NOTION_VERSION = '2026-03-11';
  });

  it('returns Notion API search results without env allowlist filtering', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.notion.com/v1/search') {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                id: 'page-1',
                object: 'page',
                url: 'https://notion.so/page-1',
                properties: {
                  Name: {
                    type: 'title',
                    title: [{ plain_text: 'API Rate Limiting - Design Spec' }]
                  }
                }
              },
              {
                id: 'page-2',
                object: 'page',
                url: 'https://notion.so/page-2',
                properties: {
                  Name: {
                    type: 'title',
                    title: [{ plain_text: 'Onboarding' }]
                  }
                }
              }
            ]
          })
        };
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    const { getNotionService } = await import('#lib/server/context-sources/notion');
    const notion = getNotionService();
    const result = await notion.search('checkout go live readiness', 3);

    expect(result).toEqual({
      results: [
        {
          id: 'page-1',
          title: 'API Rate Limiting - Design Spec',
          url: 'https://notion.so/page-1',
          object: 'page'
        },
        {
          id: 'page-2',
          title: 'Onboarding',
          url: 'https://notion.so/page-2',
          object: 'page'
        }
      ],
      strategy: 'notion_api_search'
    });
    expect(JSON.parse(String(initBody(fetchMock)))).toMatchObject({
      query: 'checkout go live readiness'
    });
  });
});

function initBody(fetchMock: ReturnType<typeof vi.fn>): BodyInit | null | undefined {
  return fetchMock.mock.calls[0]?.[1]?.body;
}
