import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('NotionService search fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NOTION_API_KEY = 'test-key';
    process.env.NOTION_ALLOWED_PAGE_IDS = 'page-1,page-2';
    process.env.NOTION_ALLOWED_DATA_SOURCE_IDS = '';
    process.env.NOTION_VERSION = '2026-03-11';
  });

  it('falls back to allowed page scan when title search returns no matches', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.notion.com/v1/search') {
        return {
          ok: true,
          json: async () => ({ results: [] })
        };
      }

      if (url === 'https://api.notion.com/v1/pages/page-1') {
        return {
          ok: true,
          json: async () => ({
            id: 'page-1',
            url: 'https://notion.so/page-1',
            properties: {
              Name: {
                type: 'title',
                title: [{ plain_text: 'Checkout launch readiness decision' }]
              }
            }
          })
        };
      }

      if (url === 'https://api.notion.com/v1/pages/page-2') {
        return {
          ok: true,
          json: async () => ({
            id: 'page-2',
            url: 'https://notion.so/page-2',
            properties: {
              Name: {
                type: 'title',
                title: [{ plain_text: 'Support staffing notes' }]
              }
            }
          })
        };
      }

      if (url.startsWith('https://api.notion.com/v1/blocks/page-1/children?')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                id: 'block-1',
                type: 'paragraph',
                paragraph: {
                  rich_text: [{ plain_text: 'Hold launch until checkout wallet failures drop below threshold.' }]
                }
              }
            ],
            has_more: false
          })
        };
      }

      if (url.startsWith('https://api.notion.com/v1/blocks/page-2/children?')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                id: 'block-2',
                type: 'paragraph',
                paragraph: {
                  rich_text: [{ plain_text: 'Support schedule for next week.' }]
                }
              }
            ],
            has_more: false
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
          title: 'Checkout launch readiness decision',
          url: 'https://notion.so/page-1',
          object: 'page'
        }
      ],
      strategy: 'allowed_page_scan',
      scannedAllowedPageCount: 2
    });
  });
});
