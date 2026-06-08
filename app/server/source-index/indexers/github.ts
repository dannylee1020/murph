import { resolveCredential } from '#app/server/integrations/credentials';
import { GitHubService } from '#app/server/context-sources/github';
import {
  SOURCE_INDEX_SCHEMA_VERSION,
  type SourceIndexResource,
  writeSourceIndexResource
} from '../catalog.js';

interface GitHubIssueListItem {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state?: string;
  updated_at?: string;
  pull_request?: unknown;
}

interface GitHubIndexResult {
  resourceCount: number;
  changedPaths: string[];
  cursor?: string;
}

function providerKind(item: GitHubIssueListItem): 'issue' | 'pull_request' {
  return item.pull_request ? 'pull_request' : 'issue';
}

async function fetchRepoIssues(repository: string, credential: string, limit: number): Promise<GitHubIssueListItem[]> {
  const url = new URL(`https://api.github.com/repos/${repository}/issues`);
  url.searchParams.set('state', 'all');
  url.searchParams.set('sort', 'updated');
  url.searchParams.set('direction', 'desc');
  url.searchParams.set('per_page', String(Math.max(1, Math.min(limit, 50))));
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${credential}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub source index failed for ${repository}: HTTP ${response.status}`);
  }
  return await response.json() as GitHubIssueListItem[];
}

export async function indexGitHubSource(workspaceId: string, limitPerRepository = 25): Promise<GitHubIndexResult> {
  const credential = resolveCredential(workspaceId, 'github')?.value;
  if (!credential) {
    return { resourceCount: 0, changedPaths: [] };
  }
  const service = new GitHubService();
  const repositories = service.repositories(workspaceId);
  if (repositories.length === 0) {
    return { resourceCount: 0, changedPaths: [] };
  }

  const changedPaths: string[] = [];
  let cursor: string | undefined;
  for (const repository of repositories) {
    const items = await fetchRepoIssues(repository, credential, limitPerRepository);
    for (const item of items) {
      const kind = providerKind(item);
      const title = `${repository}#${item.number} ${item.title}`;
      const resource: SourceIndexResource = {
        metadata: {
          schemaVersion: SOURCE_INDEX_SCHEMA_VERSION,
          provider: 'github',
          workspaceId,
          resourceType: kind,
          externalId: `${repository}#${item.number}`,
          title,
          url: item.html_url,
          sourceUpdatedAt: item.updated_at,
          indexedAt: new Date().toISOString(),
          scope: repository,
          readTool: kind === 'pull_request' ? 'github.read_pr' : 'github.read_issue',
          readInput: { repository, number: item.number },
          status: 'active',
          summaryStatus: 'missing',
          tags: ['github', repository, item.state ?? 'unknown', kind]
        },
        routingNotes: `Use this ${kind === 'pull_request' ? 'pull request' : 'issue'} for questions about ${repository}#${item.number}, ${item.title}, state ${item.state ?? 'unknown'}, or recent ${repository} activity.`,
        contentPreview: item.body ?? undefined
      };
      const result = await writeSourceIndexResource(resource);
      changedPaths.push(result.relativePath);
      cursor = item.updated_at ?? cursor;
    }
  }
  return { resourceCount: changedPaths.length, changedPaths, cursor };
}
