import { resolveCredential } from '#app/server/integrations/credentials';
import type { ContextArtifact } from '#app/types';

interface LinearGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url?: string | null;
  updatedAt?: string | null;
  state?: { name?: string | null } | null;
  assignee?: { name?: string | null; email?: string | null } | null;
  team?: { name?: string | null; key?: string | null } | null;
  project?: { name?: string | null } | null;
}

interface LinearIssueConnection {
  nodes?: LinearIssueNode[];
}

interface LinearViewerResponse {
  viewer?: {
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
  } | null;
}

interface LinearIssuesResponse {
  issues?: LinearIssueConnection;
}

export interface LinearIssueResult {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url?: string;
  state?: string;
  assignee?: string;
  team?: string;
  project?: string;
  updatedAt?: string;
}

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  updatedAt
  state { name }
  assignee { name email }
  team { name key }
  project { name }
`;

function compact(value: string | null | undefined, limit = 6000): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function nodeToResult(node: LinearIssueNode): LinearIssueResult {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: compact(node.description),
    url: node.url ?? undefined,
    state: node.state?.name ?? undefined,
    assignee: node.assignee?.name ?? node.assignee?.email ?? undefined,
    team: node.team?.key ?? node.team?.name ?? undefined,
    project: node.project?.name ?? undefined,
    updatedAt: node.updatedAt ?? undefined
  };
}

export function toArtifact(issue: LinearIssueResult): ContextArtifact {
  return {
    id: `linear:${issue.id}`,
    source: 'linear',
    type: 'issue',
    title: `${issue.identifier} ${issue.title}`,
    text: issue.description || issue.title,
    url: issue.url,
    metadata: {
      identifier: issue.identifier,
      state: issue.state,
      assignee: issue.assignee,
      team: issue.team,
      project: issue.project,
      updatedAt: issue.updatedAt
    }
  };
}

export class LinearService {
  isConfigured(workspaceId?: string): boolean {
    return Boolean(resolveCredential(workspaceId, 'linear'));
  }

  async validateCredential(credential: string): Promise<Record<string, unknown>> {
    const result = await this.graphql<LinearViewerResponse>(credential, `
      query ValidateLinearCredential {
        viewer {
          name
          displayName
          email
        }
      }
    `);
    const viewer = result.viewer;
    return {
      account: viewer?.displayName ?? viewer?.name ?? viewer?.email
    };
  }

  async searchIssues(query: string, limit = 5, workspaceId?: string): Promise<{ results: LinearIssueResult[] }> {
    const credential = resolveCredential(workspaceId, 'linear')?.value;
    if (!credential) {
      throw new Error('LINEAR_API_KEY is not configured');
    }

    const first = Math.max(1, Math.min(limit, 20));
    const result = await this.graphql<LinearIssuesResponse>(credential, `
      query SearchLinearIssues($query: String!, $first: Int!) {
        issues(
          first: $first
          filter: {
            or: [
              { title: { containsIgnoreCase: $query } }
              { description: { containsIgnoreCase: $query } }
              { identifier: { containsIgnoreCase: $query } }
            ]
          }
        ) {
          nodes {
            ${ISSUE_FIELDS}
          }
        }
      }
    `, { query, first });

    return {
      results: (result.issues?.nodes ?? []).map(nodeToResult)
    };
  }

  async listRecentIssues(limit = 25, workspaceId?: string): Promise<{ results: LinearIssueResult[] }> {
    const credential = resolveCredential(workspaceId, 'linear')?.value;
    if (!credential) {
      throw new Error('LINEAR_API_KEY is not configured');
    }

    const first = Math.max(1, Math.min(limit, 50));
    const result = await this.graphql<LinearIssuesResponse>(credential, `
      query RecentLinearIssues($first: Int!) {
        issues(first: $first, orderBy: updatedAt) {
          nodes {
            ${ISSUE_FIELDS}
          }
        }
      }
    `, { first });

    return {
      results: (result.issues?.nodes ?? []).map(nodeToResult)
    };
  }

  async readIssue(issueId: string, workspaceId?: string): Promise<LinearIssueResult> {
    const credential = resolveCredential(workspaceId, 'linear')?.value;
    if (!credential) {
      throw new Error('LINEAR_API_KEY is not configured');
    }

    const result = await this.graphql<LinearIssuesResponse>(credential, `
      query ReadLinearIssue($issueId: String!) {
        issues(
          first: 1
          filter: {
            or: [
              { id: { eq: $issueId } }
              { identifier: { eqIgnoreCase: $issueId } }
            ]
          }
        ) {
          nodes {
            ${ISSUE_FIELDS}
          }
        }
      }
    `, { issueId });

    const issue = result.issues?.nodes?.[0];
    if (!issue) {
      throw new Error(`Linear issue not found: ${issueId}`);
    }
    return nodeToResult(issue);
  }

  private async graphql<T>(
    credential: string,
    query: string,
    variables: Record<string, unknown> = {}
  ): Promise<T> {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: credential,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, variables })
    });
    const payload = await response.json().catch(() => ({})) as LinearGraphQLResponse<T>;
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join('; ');
    if (!response.ok || message) {
      throw new Error(message || `Linear request failed with ${response.status}`);
    }
    if (!payload.data) {
      throw new Error('Linear response did not include data');
    }
    return payload.data;
  }
}

let singleton: LinearService | null = null;

export function getLinearService(): LinearService {
  if (!singleton) {
    singleton = new LinearService();
  }

  return singleton;
}
