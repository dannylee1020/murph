import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadTool() {
  vi.resetModules();
  const module = await import('../../src/lib/server/tools/web-search');
  return module.createWebSearchTool();
}

describe('web.search tool', () => {
  afterEach(() => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.MURPH_WEB_SEARCH_BACKEND;
    vi.unstubAllGlobals();
  });

  it('uses Tavily by default', async () => {
    process.env.TAVILY_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ title: 'What is X?', url: 'https://example.com/x', content: 'X is a thing.' }]
      })
    }));
    const tool = await loadTool();

    const result = await tool.execute({ query: 'what is x?' }, { workspace: { id: 'T1', slackTeamId: 'T1', name: 'Test' } });

    expect(result.backend).toBe('tavily');
    expect(result.results).toEqual([
      {
        title: 'What is X?',
        url: 'https://example.com/x',
        snippet: 'X is a thing.'
      }
    ]);
  });
});
