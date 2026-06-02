import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function tempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('source index provider indexers', () => {
  beforeEach(() => {
    vi.resetModules();
    const root = tempRoot('murph-source-indexers-');
    process.env.MURPH_MEMORY_PATH = join(root, 'memory');
    process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
    delete process.env.GITHUB_PAT;
    delete process.env.GITHUB_REPOSITORIES;
    delete process.env.OBSIDIAN_VAULT_PATH;
  });

  it('indexes GitHub issues only from configured repositories', async () => {
    process.env.GITHUB_PAT = 'test-pat';
    process.env.GITHUB_REPOSITORIES = 'acme/app';
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/repos/acme/app/issues');
      return {
        ok: true,
        json: async () => [{
          id: 101,
          number: 42,
          title: 'Checkout launch blocker',
          body: 'Payment callback verification remains open.',
          html_url: 'https://github.com/acme/app/issues/42',
          state: 'open',
          updated_at: '2026-06-02T19:00:00Z'
        }]
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { indexGitHubSource } = await import('../../shared/server/source-index/indexers/github');
    const result = await indexGitHubSource('workspace-1');

    expect(result.resourceCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/repos/acme/app/issues');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('acme/other');
    const markdown = readFileSync(join(process.env.MURPH_MEMORY_PATH!, 'source-index', result.changedPaths[0]), 'utf8');
    expect(markdown).toContain('externalId: acme/app#42');
    expect(markdown).toContain('## Routing Notes');
    expect(markdown).not.toContain('## Summary');
    expect(markdown).not.toContain('## Excerpt');
  });

  it('indexes Obsidian markdown from the configured vault only', async () => {
    const root = tempRoot('murph-obsidian-indexer-');
    const vault = join(root, 'vault');
    const outside = join(root, 'outside');
    mkdirSync(vault, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(vault, 'Launch.md'), 'Launch status lives here.');
    writeFileSync(join(outside, 'Secret.md'), 'This file is outside the vault.');
    process.env.MURPH_MEMORY_PATH = join(root, 'memory');
    process.env.OBSIDIAN_VAULT_PATH = vault;

    const { indexObsidianSource } = await import('../../shared/server/source-index/indexers/obsidian');
    const result = await indexObsidianSource('workspace-1');

    expect(result.resourceCount).toBe(1);
    const markdownPath = join(process.env.MURPH_MEMORY_PATH!, 'source-index', result.changedPaths[0]);
    expect(existsSync(markdownPath)).toBe(true);
    const markdown = readFileSync(markdownPath, 'utf8');
    expect(markdown).toContain('externalId: Launch.md');
    expect(markdown).not.toContain('Secret.md');
  });
});
