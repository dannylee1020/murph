import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('GitHubService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GITHUB_PAT = 'test-pat';
  });

  it('searches GitHub issues and pull requests and maps results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 101,
            number: 42,
            title: 'Fix checkout wallet bug',
            body: 'The wallet flow fails on mobile.',
            html_url: 'https://github.com/acme/app/issues/42',
            repository_url: 'https://api.github.com/repos/acme/app'
          },
          {
            id: 102,
            number: 99,
            title: 'Launch readiness PR',
            body: 'Pre-launch cleanup',
            html_url: 'https://github.com/acme/app/pull/99',
            repository_url: 'https://api.github.com/repos/acme/app',
            pull_request: { html_url: 'https://github.com/acme/app/pull/99' }
          }
        ]
      })
    }));

    const { getGitHubService, toArtifact } = await import('#lib/server/context-sources/github');
    const github = getGitHubService();
    const result = await github.search('checkout launch', 3);

    expect(result.results).toEqual([
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
    ]);
    expect(toArtifact(result.results[1])).toEqual(
      expect.objectContaining({
        type: 'pull_request',
        title: 'acme/app#99 Launch readiness PR'
      })
    );
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
