import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('GitHubService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-github-service-')), 'murph.sqlite');
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
    process.env.GITHUB_PAT = 'test-pat';
    process.env.GITHUB_REPOSITORIES = 'acme/app';
  });

  it('searches GitHub issues and pull requests and maps results', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/repos/acme/app/issues/42') {
        return {
          ok: true,
          json: async () => ({
            id: 101,
            number: 42,
            title: 'Fix checkout wallet bug',
            body: 'The wallet flow fails on mobile.',
            html_url: 'https://github.com/acme/app/issues/42',
            repository_url: 'https://api.github.com/repos/acme/app',
            state: 'open'
          })
        };
      }
      if (parsed.pathname === '/repos/acme/app/pulls/99') {
        return {
          ok: true,
          json: async () => ({
            id: 102,
            number: 99,
            title: 'Launch readiness PR',
            body: 'Pre-launch cleanup',
            html_url: 'https://github.com/acme/app/pull/99',
            repository_url: 'https://api.github.com/repos/acme/app',
            state: 'open',
            merged_at: null
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: 101,
              number: 42,
              title: 'Fix checkout wallet bug',
              body: 'The wallet flow fails on mobile.',
              html_url: 'https://github.com/acme/app/issues/42',
              repository_url: 'https://api.github.com/repos/acme/app',
              state: 'open'
            },
            {
              id: 102,
              number: 99,
              title: 'Launch readiness PR',
              body: 'Pre-launch cleanup',
              html_url: 'https://github.com/acme/app/pull/99',
              repository_url: 'https://api.github.com/repos/acme/app',
              state: 'open',
              pull_request: { html_url: 'https://github.com/acme/app/pull/99' }
            }
          ]
        })
      };
    }));

    const { getGitHubService, toArtifact } = await import('#lib/server/context-sources/github');
    const github = getGitHubService();
    const result = await github.search('checkout launch', 3);

    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'github:101',
        repository: 'acme/app',
        kind: 'issue'
      }),
      expect.objectContaining({
        id: 'github:102',
        repository: 'acme/app',
        kind: 'pull_request'
      })
    ]));
    const pullRequest = result.results.find((item) => item.kind === 'pull_request');
    expect(toArtifact(pullRequest!)).toEqual(
      expect.objectContaining({
        type: 'pull_request',
        title: 'acme/app#99 Launch readiness PR'
      })
    );
    const requestedUrl = new URL((fetch as any).mock.calls[0][0]);
    expect(requestedUrl.searchParams.get('q')).toBe('checkout launch repo:acme/app');
    expect(result.diagnostics.searchQueries).toContain('checkout launch repo:acme/app');
  });

  it('requires repository scope before search', async () => {
    process.env.GITHUB_REPOSITORIES = '';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => []
    }));
    const { getGitHubService } = await import('#lib/server/context-sources/github');
    const github = getGitHubService();

    await expect(github.search('checkout launch', 3)).rejects.toThrow('GitHub repository scope is required');
  });

  it('auto-discovers recently updated repositories when no repository scope is selected', async () => {
    process.env.GITHUB_REPOSITORIES = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/user/repos') {
        return {
          ok: true,
          json: async () => [{ full_name: 'acme/app', private: true, owner: { login: 'acme' }, name: 'app' }]
        };
      }
      if (parsed.pathname === '/repos/acme/app/issues/42') {
        return {
          ok: true,
          json: async () => ({
            id: 101,
            number: 42,
            title: 'Rate limiting status',
            body: 'The Acme rate limiting PR is open.',
            html_url: 'https://github.com/acme/app/issues/42',
            repository_url: 'https://api.github.com/repos/acme/app',
            state: 'open'
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: 101,
              number: 42,
              title: 'Rate limiting status',
              body: 'The Acme rate limiting PR is open.',
              html_url: 'https://github.com/acme/app/issues/42',
              repository_url: 'https://api.github.com/repos/acme/app',
              state: 'open'
            }
          ]
        })
      };
    }));

    const { getGitHubService } = await import('#lib/server/context-sources/github');
    const github = getGitHubService();
    const result = await github.search('rate limiting Acme', 3);

    expect(result.results).toEqual([
      expect.objectContaining({
        repository: 'acme/app',
        number: 42
      })
    ]);
    const requestedUrls = (fetch as any).mock.calls.map((call: any[]) => new URL(call[0]));
    expect(requestedUrls[0].pathname).toBe('/user/repos');
    expect(requestedUrls[0].searchParams.get('per_page')).toBe('10');
    expect(requestedUrls[1].searchParams.get('q')).toBe('rate limiting Acme repo:acme/app');
  });

  it('lists visible repositories for picker setup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          full_name: 'acme/app',
          private: true,
          owner: { login: 'acme' },
          name: 'app'
        }
      ])
    }));

    const { getGitHubService } = await import('#lib/server/context-sources/github');
    const github = getGitHubService();
    const result = await github.listRepositories();

    expect(result.repositories).toEqual([
      { fullName: 'acme/app', private: true, owner: 'acme', name: 'app' }
    ]);
  });

  it('uses resilient GitHub search for thread grounding and returns issues and pull requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/repos/acme/app/issues/42') {
        return {
          ok: true,
          json: async () => ({
            id: 202,
            number: 42,
            title: 'API requests are unbounded — need per-tenant rate limiting before Acme launch',
            body: 'Open checklist items remain for tiered limits and retry guidance.',
            html_url: 'https://github.com/acme/app/issues/42',
            repository_url: 'https://api.github.com/repos/acme/app',
            state: 'open'
          })
        };
      }
      if (parsed.pathname === '/repos/acme/app/pulls/99') {
        return {
          ok: true,
          json: async () => ({
            id: 203,
            number: 99,
            title: 'feat: add per-tenant API rate limiting middleware',
            body: 'Sliding window rate limiter using Redis.',
            html_url: 'https://github.com/acme/app/pull/99',
            repository_url: 'https://api.github.com/repos/acme/app',
            state: 'open',
            merged_at: null
          })
        };
      }

      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: 202,
              number: 42,
              title: 'API requests are unbounded — need per-tenant rate limiting before Acme launch',
              body: 'Open checklist items remain for tiered limits and retry guidance.',
              html_url: 'https://github.com/acme/app/issues/42',
              repository_url: 'https://api.github.com/repos/acme/app',
              state: 'open'
            },
            {
              id: 203,
              number: 99,
              title: 'feat: add per-tenant API rate limiting middleware',
              body: 'Sliding window rate limiter using Redis.',
              html_url: 'https://github.com/acme/app/pull/99',
              repository_url: 'https://api.github.com/repos/acme/app',
              state: 'open',
              pull_request: { html_url: 'https://github.com/acme/app/pull/99' }
            }
          ]
        })
      };
    }));

    const { createGitHubAdapter } = await import('#lib/server/integrations/github/index');
    const adapter = createGitHubAdapter();
    const source = adapter.contextSources[0];
    const input = {
      workspace: { id: 'workspace-1', provider: 'slack', externalWorkspaceId: 'T1', name: 'Test' },
      task: {} as any,
      context: {
        thread: {
          latestMessage: 'are we on track to land the rate limiting work before the Acme deadline? Just want to know if there is anything blocking that I should escalate.',
          recentMessages: []
        }
      } as any
    };

    const artifacts = await source.retrieve(input);
    expect(artifacts).toEqual([
      expect.objectContaining({
        title: 'acme/app#42 API requests are unbounded — need per-tenant rate limiting before Acme launch',
        type: 'issue'
      }),
      expect.objectContaining({
        title: 'acme/app#99 feat: add per-tenant API rate limiting middleware',
        type: 'pull_request'
      })
    ]);
    const requestedUrl = new URL((fetch as any).mock.calls[0][0]);
    expect(requestedUrl.pathname).toBe('/search/issues');
    expect(requestedUrl.searchParams.get('q')).toBe('rate limiting Acme repo:acme/app');
    const searchQueries = (fetch as any).mock.calls
      .map((call: any[]) => new URL(call[0]))
      .filter((url: URL) => url.pathname === '/search/issues')
      .map((url: URL) => url.searchParams.get('q'));
    expect(searchQueries).not.toContain('rate limiting Acme deadline blocking repo:acme/app');
  });

  it('falls back to recent repository activity when broad search returns no results', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/search/issues') {
        return {
          ok: true,
          json: async () => ({ items: [] })
        };
      }
      if (parsed.pathname === '/repos/acme/app/issues/42') {
        return {
          ok: true,
          json: async () => ({
            id: 301,
            number: 42,
            title: 'Rate limiting rollout status',
            body: 'The Acme launch work is blocked on retry guidance.',
            html_url: 'https://github.com/acme/app/issues/42',
            repository_url: 'https://api.github.com/repos/acme/app',
            state: 'open'
          })
        };
      }
      return {
        ok: true,
        json: async () => ([
          {
            id: 301,
            number: 42,
            title: 'Rate limiting rollout status',
            body: 'The Acme launch work is blocked on retry guidance.',
            html_url: 'https://github.com/acme/app/issues/42',
            repository_url: 'https://api.github.com/repos/acme/app',
            state: 'open'
          }
        ])
      };
    }));

    const { getGitHubService } = await import('#lib/server/context-sources/github');
    const github = getGitHubService();
    const result = await github.search('rate limiting Acme deadline blocking', 5);

    expect(result.results).toEqual([
      expect.objectContaining({
        repository: 'acme/app',
        number: 42,
        body: 'The Acme launch work is blocked on retry guidance.'
      })
    ]);
    expect(result.diagnostics.fallbackUsed).toBe(true);
    const requestedPaths = (fetch as any).mock.calls.map((call: any[]) => new URL(call[0]).pathname);
    expect(requestedPaths).toContain('/repos/acme/app/issues');
  });

  it('reads issues by repository and number', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 101,
        number: 42,
        title: 'Fix checkout wallet bug',
        body: 'The wallet flow fails on mobile.',
        html_url: 'https://github.com/acme/app/issues/42',
        repository_url: 'https://api.github.com/repos/acme/app',
        state: 'open'
      })
    }));

    const { getGitHubService } = await import('#lib/server/context-sources/github');
    const github = getGitHubService();
    const result = await github.readIssue('acme/app', 42);

    expect(result).toEqual(
      expect.objectContaining({
        repository: 'acme/app',
        number: 42,
        kind: 'issue',
        state: 'open'
      })
    );
  });
});
