import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadTool() {
  vi.resetModules();
  const module = await import('../../src/lib/server/tools/web-fetch');
  return module.createWebFetchTool();
}

describe('web.fetch tool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and extracts readable HTML text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => '<html><head><title>Launch Plan</title></head><body><h1>Launch Plan</h1><p>Hold until approval.</p></body></html>'
    }));
    const tool = await loadTool();

    const result = await tool.execute({ url: 'https://example.com' }, { workspace: { id: 'T1', slackTeamId: 'T1', name: 'Test' } });

    expect(result.title).toBe('Launch Plan');
    expect(result.text).toContain('Hold until approval.');
    expect(result.truncated).toBe(false);
  });
});
