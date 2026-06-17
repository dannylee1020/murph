import { resolveCredential } from '#app/server/integrations/credentials';
import { getStore } from '#app/server/persistence/store';
import { getRuntimeEnv } from '#app/server/util/env';
import type { ContextArtifact } from '#app/types';

interface GitHubSearchResponse {
  items?: GitHubSearchItem[];
  incomplete_results?: boolean;
}

interface GitHubRepositoryResponse {
  full_name: string;
  private?: boolean;
  owner?: { login?: string };
  name?: string;
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
  draft?: boolean;
  updated_at?: string | null;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
}

interface GitHubUserResponse {
  login?: string;
}

interface GitHubPullFileResponse {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

interface GitHubPullCommitResponse {
  sha: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: {
      name?: string;
      date?: string;
    };
    committer?: {
      name?: string;
      date?: string;
    };
  };
  author?: GitHubUserResponse | null;
}

interface GitHubCommentResponse {
  id: number;
  body?: string | null;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  user?: GitHubUserResponse | null;
}

interface GitHubReviewResponse {
  id: number;
  body?: string | null;
  html_url?: string;
  state?: string;
  submitted_at?: string;
  user?: GitHubUserResponse | null;
}

interface GitHubReviewCommentResponse extends GitHubCommentResponse {
  path?: string;
  diff_hunk?: string;
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
  draft?: boolean;
  changedFiles?: number;
  commitCount?: number;
  commentCount?: number;
  reviewCount?: number;
  reviewCommentCount?: number;
  activityTrailDays?: number;
  readErrors?: string[];
}

export type GitHubResult = GitHubSearchResult | GitHubReadResult;

export interface GitHubRepository {
  fullName: string;
  private: boolean;
  owner: string;
  name: string;
}

export interface GitHubSearchDiagnostics {
  rawQuery: string;
  searchQueries: string[];
  resultCounts: Record<string, number>;
  fallbackUsed: boolean;
  repositories: string[];
}

const DEEP_READ_LIMIT = 3;
const SEARCH_VARIANT_LIMIT = 4;
const ACTIVITY_TRAIL_DAYS = 7;
const ACTIVITY_TRAIL_MS = ACTIVITY_TRAIL_DAYS * 24 * 60 * 60 * 1000;
const MAX_PR_FILES = 6;
const MAX_ACTIVITY_ITEMS = 6;
const RANKING_ONLY_TERMS = new Set([
  'blocked',
  'blocker',
  'blockers',
  'blocking',
  'deadline',
  'deadlines',
  'escalate',
  'escalated',
  'escalation',
  'status',
  'track'
]);

function parseRepositoryName(repositoryUrl: string): string {
  const parts = repositoryUrl.split('/').slice(-2);
  return parts.join('/');
}

function compactText(value: string | null | undefined, maxLength = 4000): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function compactMultiline(value: string | null | undefined, maxLength = 6000): string {
  return (value ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function firstLine(value: string | null | undefined, maxLength = 220): string {
  return compactText(value, maxLength).split('\n')[0] ?? '';
}

function actorName(user?: GitHubUserResponse | null, fallback?: string): string {
  return user?.login ?? fallback ?? 'unknown';
}

function recentItems<T>(items: T[], getDate: (item: T) => string | null | undefined): T[] {
  return items
    .map((item) => ({ item, timestamp: Date.parse(getDate(item) ?? '') }))
    .filter(({ timestamp }) => Number.isFinite(timestamp) && Date.now() - timestamp <= ACTIVITY_TRAIL_MS)
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(({ item }) => item)
    .slice(0, MAX_ACTIVITY_ITEMS);
}

function renderPullRequestBody(
  repository: string,
  pull: GitHubPullResponse,
  related: {
    files: GitHubPullFileResponse[];
    commits: GitHubPullCommitResponse[];
    comments: GitHubCommentResponse[];
    reviews: GitHubReviewResponse[];
    reviewComments: GitHubReviewCommentResponse[];
  },
  readErrors: string[]
): string {
  const recentCommits = recentItems(
    related.commits,
    (commit) => commit.commit?.committer?.date ?? commit.commit?.author?.date
  );
  const recentComments = recentItems(related.comments, (comment) => comment.updated_at ?? comment.created_at);
  const recentReviews = recentItems(related.reviews, (review) => review.submitted_at);
  const recentReviewComments = recentItems(
    related.reviewComments,
    (comment) => comment.updated_at ?? comment.created_at
  );
  const lines: string[] = [
    `Pull request ${repository}#${pull.number}: ${pull.title}`,
    `State: ${pull.state ?? 'unknown'}; merged: ${pull.merged_at ? 'yes' : 'no'}; draft: ${pull.draft ? 'yes' : 'no'}; updated: ${pull.updated_at ?? 'unknown'}`,
    `PR metadata: ${pull.changed_files ?? related.files.length} changed files; ${pull.commits ?? related.commits.length} commits; +${pull.additions ?? 'unknown'} -${pull.deletions ?? 'unknown'}`
  ];

  const body = compactMultiline(pull.body, 2400);
  if (body) {
    lines.push('', 'PR body:', body);
  }

  if (related.files.length > 0) {
    lines.push('', 'Changed files:');
    for (const file of related.files.slice(0, MAX_PR_FILES)) {
      lines.push(`- ${file.filename} (${file.status ?? 'modified'}, +${file.additions ?? 0} -${file.deletions ?? 0})`);
      const patch = compactMultiline(file.patch, 900);
      if (patch) {
        lines.push(`  Patch excerpt:\n${patch}`);
      }
    }
  }

  if (recentCommits.length > 0) {
    lines.push('', `Recent commits in last ${ACTIVITY_TRAIL_DAYS} days:`);
    for (const commit of recentCommits) {
      const sha = commit.sha.slice(0, 7);
      const date = commit.commit?.committer?.date ?? commit.commit?.author?.date ?? 'unknown date';
      lines.push(`- ${sha} by ${actorName(commit.author, commit.commit?.author?.name)} on ${date}: ${firstLine(commit.commit?.message)}`);
    }
  }

  if (recentComments.length > 0) {
    lines.push('', `Recent issue comments in last ${ACTIVITY_TRAIL_DAYS} days:`);
    for (const comment of recentComments) {
      lines.push(`- ${actorName(comment.user)} on ${comment.updated_at ?? comment.created_at ?? 'unknown date'}: ${firstLine(comment.body)}`);
    }
  }

  if (recentReviews.length > 0) {
    lines.push('', `Recent reviews in last ${ACTIVITY_TRAIL_DAYS} days:`);
    for (const review of recentReviews) {
      lines.push(`- ${actorName(review.user)} ${review.state ?? 'reviewed'} on ${review.submitted_at ?? 'unknown date'}: ${firstLine(review.body)}`);
    }
  }

  if (recentReviewComments.length > 0) {
    lines.push('', `Recent review comments in last ${ACTIVITY_TRAIL_DAYS} days:`);
    for (const comment of recentReviewComments) {
      const location = comment.path ? `${comment.path}: ` : '';
      lines.push(`- ${actorName(comment.user)} on ${comment.updated_at ?? comment.created_at ?? 'unknown date'}: ${location}${firstLine(comment.body)}`);
    }
  }

  if (readErrors.length > 0) {
    lines.push('', 'Read notes:', ...readErrors.map((error) => `- ${error}`));
  }

  return compactMultiline(lines.join('\n'), 9000);
}

function normalizeRepositories(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter((value) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value));
}

function dedupeResults(results: GitHubSearchResult[]): GitHubSearchResult[] {
  const seen = new Set<string>();
  const deduped: GitHubSearchResult[] = [];
  for (const result of results) {
    const key = `${result.repository}#${result.number}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
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

function tokenize(value: string): string[] {
  return value.match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? [];
}

function uniqueTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(token);
  }
  return unique;
}

function hasGitHubSearchOperator(query: string): boolean {
  return /(?:^|\s)[A-Za-z_][A-Za-z0-9_-]*:[^\s]+/.test(query);
}

function buildSearchVariants(query: string): string[] {
  const trimmed = query.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return [];
  }
  if (hasGitHubSearchOperator(trimmed)) {
    return [trimmed];
  }

  const tokens = uniqueTokens(tokenize(trimmed));
  const searchable = tokens.filter((token) => !RANKING_ONLY_TERMS.has(token.toLowerCase()));
  const variants: string[] = [];

  const addVariant = (parts: string[]) => {
    const variant = parts.join(' ').trim();
    if (!variant || variants.includes(variant)) {
      return;
    }
    variants.push(variant);
  };

  const properNouns = searchable.filter((token) => /^[A-Z]/.test(token));
  const rateIndex = searchable.findIndex((token, index) =>
    token.toLowerCase() === 'rate' && searchable[index + 1]?.toLowerCase() === 'limiting'
  );
  if (rateIndex >= 0) {
    addVariant([
      searchable[rateIndex],
      searchable[rateIndex + 1],
      ...properNouns.filter((token) => !['rate', 'limiting'].includes(token.toLowerCase())).slice(0, 1)
    ]);
  }

  addVariant(searchable.slice(0, 3));
  addVariant(searchable.slice(0, 2));
  if (properNouns.length > 0) {
    addVariant([properNouns[0]]);
  }
  addVariant(searchable.slice(0, 1));
  addVariant(tokens.slice(0, 3));

  return variants.slice(0, SEARCH_VARIANT_LIMIT);
}

function scoreResult(result: GitHubSearchResult, query: string, order: number): number {
  const haystack = `${result.title} ${result.body}`.toLowerCase();
  const title = result.title.toLowerCase();
  const terms = uniqueTokens(tokenize(query));
  let score = 0;

  for (const term of terms) {
    const key = term.toLowerCase();
    if (!haystack.includes(key)) {
      continue;
    }
    score += RANKING_ONLY_TERMS.has(key) ? 2 : 6;
    if (title.includes(key)) {
      score += 4;
    }
  }

  const searchable = terms.filter((term) => !RANKING_ONLY_TERMS.has(term.toLowerCase()));
  for (let index = 0; index < searchable.length - 1; index += 1) {
    const phrase = `${searchable[index]} ${searchable[index + 1]}`.toLowerCase();
    if (haystack.includes(phrase)) {
      score += 12;
    }
    if (title.includes(phrase)) {
      score += 8;
    }
  }

  if (result.state === 'open') {
    score += 1;
  }
  if (result.kind === 'pull_request') {
    score += 1;
  }

  return score - order / 1000;
}

function rankResults(results: GitHubSearchResult[], query: string, limit: number): GitHubSearchResult[] {
  return results
    .map((result, order) => ({ result, score: scoreResult(result, query, order) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ result }) => result);
}

export class GitHubService {
  isConfigured(workspaceId?: string): boolean {
    return Boolean(resolveCredential(workspaceId, 'github'));
  }

  repositories(workspaceId?: string): string[] {
    const credential = resolveCredential(workspaceId, 'github');
    const storedRepositories = normalizeRepositories(credential?.metadata?.repositories);
    if (storedRepositories.length > 0) {
      return storedRepositories;
    }

    const connectionRepositories = workspaceId
      ? normalizeRepositories(getStore().getIntegrationConnection(workspaceId, 'github')?.metadata?.repositories)
      : [];
    if (connectionRepositories.length > 0) {
      return connectionRepositories;
    }

    if (!credential) {
      return [];
    }

    return getRuntimeEnv().githubRepositories;
  }

  private retrievalRepositories(workspaceId?: string): string[] {
    return this.repositories(workspaceId);
  }

  async listRepositories(workspaceId?: string, limit = 100): Promise<{ repositories: GitHubRepository[] }> {
    const credential = resolveCredential(workspaceId, 'github')?.value;
    if (!credential) {
      throw new Error('GITHUB_PAT is not configured');
    }

    const url = new URL('https://api.github.com/user/repos');
    url.searchParams.set('affiliation', 'owner,collaborator,organization_member');
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('per_page', String(Math.max(1, Math.min(limit, 100))));
    const payload = await this.fetchJson<GitHubRepositoryResponse[]>(url.toString(), credential);

    return {
      repositories: payload
        .filter((repo) => repo.full_name)
        .map((repo) => ({
          fullName: repo.full_name,
          private: Boolean(repo.private),
          owner: repo.owner?.login ?? repo.full_name.split('/')[0] ?? '',
          name: repo.name ?? repo.full_name.split('/')[1] ?? ''
        }))
    };
  }

  async search(query: string, limit = 5, workspaceId?: string): Promise<{ results: GitHubResult[]; diagnostics: GitHubSearchDiagnostics }> {
    const credential = resolveCredential(workspaceId, 'github')?.value;
    if (!credential) {
      throw new Error('GITHUB_PAT is not configured');
    }

    const repositories = this.retrievalRepositories(workspaceId);
    if (repositories.length === 0) {
      throw new Error('GitHub repository scope is required');
    }

    const searchLimit = Math.max(1, Math.min(limit, 10));
    const variants = buildSearchVariants(query);
    const resultCounts: Record<string, number> = {};
    const searchQueries: string[] = [];
    const results: GitHubSearchResult[] = [];
    for (const repository of repositories) {
      for (const variant of variants) {
        const fullQuery = `${variant} repo:${repository}`;
        searchQueries.push(fullQuery);
        const url = new URL('https://api.github.com/search/issues');
        url.searchParams.set('q', fullQuery);
        url.searchParams.set('per_page', String(searchLimit));
        const payload = await this.fetchJson<GitHubSearchResponse>(url.toString(), credential);
        const items = payload.items ?? [];
        resultCounts[fullQuery] = items.length;
        results.push(...items.map(searchItemToResult));
      }
    }

    let fallbackUsed = false;
    let ranked = rankResults(dedupeResults(results), query, searchLimit);
    if (ranked.length === 0) {
      fallbackUsed = true;
      ranked = rankResults(await this.fetchRecentResults(repositories, searchLimit, credential), query, searchLimit);
    }

    const enriched = await this.enrichTopResults(ranked, workspaceId);
    return {
      results: enriched,
      diagnostics: {
        rawQuery: query,
        searchQueries,
        resultCounts,
        fallbackUsed,
        repositories
      }
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

    const pull = await this.fetchJson<GitHubPullResponse>(`https://api.github.com/repos/${repository}/pulls/${number}`, credential);
    const readErrors: string[] = [];
    const fetchRelated = async <T>(label: string, path: string): Promise<T[]> => {
      try {
        return await this.fetchJson<T[]>(`https://api.github.com/repos/${repository}/${path}`, credential);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        readErrors.push(`${label} could not be read: ${message}`);
        return [];
      }
    };
    const [files, commits, comments, reviews, reviewComments] = await Promise.all([
      fetchRelated<GitHubPullFileResponse>('Changed files', `pulls/${number}/files`),
      fetchRelated<GitHubPullCommitResponse>('Commits', `pulls/${number}/commits`),
      fetchRelated<GitHubCommentResponse>('Issue comments', `issues/${number}/comments`),
      fetchRelated<GitHubReviewResponse>('Reviews', `pulls/${number}/reviews`),
      fetchRelated<GitHubReviewCommentResponse>('Review comments', `pulls/${number}/comments`)
    ]);
    const related = {
      files,
      commits,
      comments,
      reviews,
      reviewComments
    };
    const base = readItemToResult(repository, pull, 'pull_request');
    return {
      ...base,
      body: renderPullRequestBody(repository, pull, related, readErrors),
      draft: pull.draft,
      changedFiles: pull.changed_files ?? files.length,
      commitCount: recentItems(
        commits,
        (commit) => commit.commit?.committer?.date ?? commit.commit?.author?.date
      ).length,
      commentCount: recentItems(comments, (comment) => comment.updated_at ?? comment.created_at).length,
      reviewCount: recentItems(reviews, (review) => review.submitted_at).length,
      reviewCommentCount: recentItems(
        reviewComments,
        (comment) => comment.updated_at ?? comment.created_at
      ).length,
      activityTrailDays: ACTIVITY_TRAIL_DAYS,
      readErrors: readErrors.length > 0 ? readErrors : undefined
    };
  }

  private async fetchRecentResults(
    repositories: string[],
    limit: number,
    credential: string
  ): Promise<GitHubSearchResult[]> {
    const results: GitHubSearchResult[] = [];
    for (const repository of repositories) {
      const url = new URL(`https://api.github.com/repos/${repository}/issues`);
      url.searchParams.set('state', 'all');
      url.searchParams.set('sort', 'updated');
      url.searchParams.set('direction', 'desc');
      url.searchParams.set('per_page', String(Math.max(1, Math.min(limit * 2, 25))));
      const payload = await this.fetchJson<GitHubSearchItem[]>(url.toString(), credential);
      results.push(...payload.map((item) => ({
        ...searchItemToResult(item),
        repository
      })));
    }
    return dedupeResults(results);
  }

  private async enrichTopResults(results: GitHubSearchResult[], workspaceId?: string): Promise<GitHubResult[]> {
    const enriched: GitHubResult[] = [];
    for (const [index, result] of results.entries()) {
      if (index >= DEEP_READ_LIMIT) {
        enriched.push(result);
        continue;
      }

      try {
        enriched.push(result.kind === 'pull_request'
          ? await this.readPullRequest(result.repository, result.number, workspaceId)
          : await this.readIssue(result.repository, result.number, workspaceId));
      } catch {
        enriched.push(result);
      }
    }
    return enriched;
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
