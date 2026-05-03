import { resolveCredential } from '#lib/server/integrations/credentials';
import type { ContextArtifact } from '#lib/types';

interface GitHubSearchResponse {
  items?: GitHubSearchItem[];
  incomplete_results?: boolean;
}

interface GitHubSearchItem {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  repository_url: string;
  state?: string;
  pull_request?: {
    html_url?: string;
  };
}

interface GitHubIssueResponse {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state?: string;
  repository_url: string;
}

interface GitHubPullResponse extends GitHubIssueResponse {
  merged_at?: string | null;
}

export interface GitHubSearchResult {
  id: string;
  number: number;
  repository: string;
  title: string;
  body: string;
  url: string;
  kind: 'issue' | 'pull_request';
  state?: string;
}

export interface GitHubReadResult {
  id: string;
  number: number;
  repository: string;
  title: string;
  body: string;
  url: string;
  kind: 'issue' | 'pull_request';
  state?: string;
  mergedAt?: string | null;
}

function parseRepositoryName(repositoryUrl: string): string {
  const parts = repositoryUrl.split('/').slice(-2);
  return parts.join('/');
}

function compactText(value: string | null | undefined, maxLength = 4000): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function searchItemToResult(item: GitHubSearchItem): GitHubSearchResult {
  return {
    id: `github:${item.id}`,
    number: item.number,
    repository: parseRepositoryName(item.repository_url),
    title: item.title,
    body: compactText(item.body),
    url: item.html_url,
    kind: item.pull_request ? 'pull_request' : 'issue',
    state: item.state
  };
}

function readItemToResult(
  repository: string,
  item: GitHubIssueResponse | GitHubPullResponse,
  kind: 'issue' | 'pull_request'
): GitHubReadResult {
  return {
    id: `github:${item.id}`,
    number: item.number,
    repository,
    title: item.title,
    body: compactText(item.body, 6000),
    url: item.html_url,
    kind,
    state: item.state,
    mergedAt: 'merged_at' in item ? item.merged_at ?? null : null
  };
}

export function toArtifact(result: GitHubSearchResult | GitHubReadResult): ContextArtifact {
  return {
    id: result.id,
    source: 'github',
    type: result.kind === 'pull_request' ? 'pull_request' : 'issue',
    title: `${result.repository}#${result.number} ${result.title}`,
    text: result.body || result.title,
    url: result.url,
    metadata: {
      repository: result.repository,
      number: result.number,
      state: result.state,
      kind: result.kind
    }
  };
}

export class GitHubService {
  isConfigured(workspaceId?: string): boolean {
    return Boolean(resolveCredential(workspaceId, 'github'));
  }

  async search(query: string, limit = 5, workspaceId?: string): Promise<{ results: GitHubSearchResult[] }> {
    const credential = resolveCredential(workspaceId, 'github')?.value;
    if (!credential) {
      throw new Error('GITHUB_PAT is not configured');
    }

    const url = new URL('https://api.github.com/search/issues');
    url.searchParams.set('q', query);
    url.searchParams.set('per_page', String(Math.max(1, Math.min(limit, 10))));

    const payload = await this.fetchJson<GitHubSearchResponse>(url.toString(), credential);
    return {
      results: (payload.items ?? []).map(searchItemToResult)
    };
  }

  async readIssue(repository: string, number: number, workspaceId?: string): Promise<GitHubReadResult> {
    const credential = resolveCredential(workspaceId, 'github')?.value;
    if (!credential) {
      throw new Error('GITHUB_PAT is not configured');
    }

    const payload = await this.fetchJson<GitHubIssueResponse>(`https://api.github.com/repos/${repository}/issues/${number}`, credential);
    return readItemToResult(repository, payload, 'issue');
  }

  async readPullRequest(repository: string, number: number, workspaceId?: string): Promise<GitHubReadResult> {
    const credential = resolveCredential(workspaceId, 'github')?.value;
    if (!credential) {
      throw new Error('GITHUB_PAT is not configured');
    }

    const payload = await this.fetchJson<GitHubPullResponse>(`https://api.github.com/repos/${repository}/pulls/${number}`, credential);
    return readItemToResult(repository, payload, 'pull_request');
  }

  private async fetchJson<T>(url: string, credential: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${credential}`,
        'User-Agent': 'murph'
      }
    });
    const payload = await response.json().catch(() => ({})) as T & { message?: string };

    if (!response.ok) {
      throw new Error(payload.message ?? `GitHub request failed with ${response.status}`);
    }

    return payload;
  }
}

let singleton: GitHubService | null = null;

export function getGitHubService(): GitHubService {
  if (!singleton) {
    singleton = new GitHubService();
  }

  return singleton;
}
