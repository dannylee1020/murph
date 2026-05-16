import { afterEach, describe, expect, it, vi } from 'vitest';

describe('web.fetch tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects non-http URLs', async () => {
    const { createWebFetchTool } = await import('../src/lib/server/tools/web-fetch');
    const tool = createWebFetchTool();

    await expect(tool.execute({ url: 'file:///etc/passwd' })).rejects.toThrow('Only http(s) URLs are allowed');
  });

  it('extracts title and readable text from HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      status: 200,
      text: async () => '<html><head><title>Example &amp; Test</title><style>bad</style></head><body><script>bad</script><h1>Hello</h1><p>Grounded text</p></body></html>'
    }));
    const { createWebFetchTool } = await import('../src/lib/server/tools/web-fetch');

    const result = await createWebFetchTool().execute({ url: 'https://example.com/page' });

    expect(result.status).toBe(200);
    expect(result.title).toBe('Example & Test');
    expect(result.text).toContain('Hello');
    expect(result.text).toContain('Grounded text');
    expect(result.text).not.toContain('bad');
  });

  it('caps returned text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      headers: new Headers({ 'content-type': 'text/plain' }),
      status: 200,
      text: async () => 'x'.repeat(1000)
    }));
    const { createWebFetchTool } = await import('../src/lib/server/tools/web-fetch');

    const result = await createWebFetchTool().execute({ url: 'https://example.com/plain', maxChars: 256 });

    expect(result.text).toHaveLength(256);
    expect(result.truncated).toBe(true);
  });
});
