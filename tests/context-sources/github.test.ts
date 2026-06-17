import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function okJson(payload: unknown) {
  return {
    ok: true,
    json: async () => payload
  };
}

function recentIso(): string {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString();
}

function oldIso(): string {
  return new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
}

function emptyPullRelatedResponse(pathname: string, number = 99) {
  const paths = [
    `/repos/acme/app/pulls/${number}/files`,
    `/repos/acme/app/pulls/${number}/commits`,
    `/repos/acme/app/issues/${number}/comments`,
    `/repos/acme/app/pulls/${number}/reviews`,
    `/repos/acme/app/pulls/${number}/comments`
  ];
  return paths.includes(pathname) ? okJson([]) : null;
}

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
      if (parsed.pathname === '/repos/acme/app/pulls/99/files') {
        return okJson([
          {
            filename: 'app/runtime.ts',
            status: 'modified',
            additions: 12,
            deletions: 2,
            patch: 'Implementation notes: tighten launch readiness checks.'
          }
        ]);
      }
      const related = emptyPullRelatedResponse(parsed.pathname);
      if (related) {
        return related;
      }
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

    const { getGitHubService, toArtifact } = await import('#app/server/context-sources/github');
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
    expect(pullRequest?.body).toContain('Implementation notes: tighten launch readiness checks.');
  });

  it('requires repository scope before runtime search', async () => {
    process.env.GITHUB_REPOSITORIES = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { getGitHubService } = await import('#app/server/context-sources/github');
    const github = getGitHubService();

    await expect(github.search('dark mode status', 3)).rejects.toThrow('GitHub repository scope is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses resilient GitHub search for thread grounding and returns issues and pull requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const related = emptyPullRelatedResponse(parsed.pathname);
      if (related) {
        return related;
      }
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

    const { createGitHubAdapter } = await import('#app/server/integrations/github/index');
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

    const { getGitHubService } = await import('#app/server/context-sources/github');
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
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/repos/acme/app/issues/42') {
        return okJson({
          id: 101,
          number: 42,
          title: 'Fix checkout wallet bug',
          body: 'The wallet flow fails on mobile.',
          html_url: 'https://github.com/acme/app/issues/42',
          repository_url: 'https://api.github.com/repos/acme/app',
          state: 'open'
        });
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ message: 'not found' })
      };
    }));

    const { getGitHubService } = await import('#app/server/context-sources/github');
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
    const requestedPaths = (fetch as any).mock.calls.map((call: any[]) => new URL(call[0]).pathname);
    expect(requestedPaths).toEqual(['/repos/acme/app/issues/42']);
  });

  it('reads pull requests with changed files and a seven day activity trail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/repos/acme/app/pulls/99') {
        return okJson({
          id: 102,
          number: 99,
          title: 'Launch readiness PR',
          body: 'Pre-launch cleanup',
          html_url: 'https://github.com/acme/app/pull/99',
          repository_url: 'https://api.github.com/repos/acme/app',
          state: 'open',
          merged_at: null,
          draft: true,
          updated_at: recentIso(),
          additions: 20,
          deletions: 4,
          changed_files: 1,
          commits: 2
        });
      }
      if (parsed.pathname === '/repos/acme/app/pulls/99/files') {
        return okJson([
          {
            filename: 'app/team-runtime.ts',
            status: 'modified',
            additions: 20,
            deletions: 4,
            patch: 'Implementation notes: remove subscriber-owned routing assumptions.'
          }
        ]);
      }
      if (parsed.pathname === '/repos/acme/app/pulls/99/commits') {
        return okJson([
          {
            sha: 'abcdef123456',
            commit: {
              message: 'Scope runtime to team sessions',
              author: { name: 'Danny', date: recentIso() },
              committer: { name: 'Danny', date: recentIso() }
            },
            author: { login: 'dannylee1020' }
          },
          {
            sha: '999999999999',
            commit: {
              message: 'Old implementation note',
              author: { name: 'Danny', date: oldIso() },
              committer: { name: 'Danny', date: oldIso() }
            },
            author: { login: 'dannylee1020' }
          }
        ]);
      }
      if (parsed.pathname === '/repos/acme/app/issues/99/comments') {
        return okJson([
          {
            id: 1,
            body: 'Rollout is waiting on OAuth validation.',
            created_at: recentIso(),
            updated_at: recentIso(),
            user: { login: 'alex' }
          },
          {
            id: 2,
            body: 'Old comment should not be included.',
            created_at: oldIso(),
            updated_at: oldIso(),
            user: { login: 'alex' }
          }
        ]);
      }
      if (parsed.pathname === '/repos/acme/app/pulls/99/reviews') {
        return okJson([
          {
            id: 3,
            body: 'Approved after runtime coverage check.',
            state: 'APPROVED',
            submitted_at: recentIso(),
            user: { login: 'sam' }
          }
        ]);
      }
      if (parsed.pathname === '/repos/acme/app/pulls/99/comments') {
        return okJson([
          {
            id: 4,
            body: 'This helper should stay narrow.',
            path: 'app/team-runtime.ts',
            created_at: recentIso(),
            updated_at: recentIso(),
            user: { login: 'riley' }
          }
        ]);
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ message: 'not found' })
      };
    }));

    const { getGitHubService } = await import('#app/server/context-sources/github');
    const github = getGitHubService();
    const result = await github.readPullRequest('acme/app', 99);

    expect(result).toEqual(expect.objectContaining({
      repository: 'acme/app',
      number: 99,
      kind: 'pull_request',
      draft: true,
      changedFiles: 1,
      commitCount: 1,
      commentCount: 1,
      reviewCount: 1,
      reviewCommentCount: 1,
      activityTrailDays: 7
    }));
    expect(result.body).toContain('Pre-launch cleanup');
    expect(result.body).toContain('Implementation notes: remove subscriber-owned routing assumptions.');
    expect(result.body).toContain('Scope runtime to team sessions');
    expect(result.body).toContain('Rollout is waiting on OAuth validation.');
    expect(result.body).toContain('Approved after runtime coverage check.');
    expect(result.body).toContain('This helper should stay narrow.');
    expect(result.body).not.toContain('Old implementation note');
    expect(result.body).not.toContain('Old comment should not be included.');
  });
});
