import { getGitHubService, toArtifact as githubToArtifact } from '#lib/server/context-sources/github';
import type { IntegrationAdapter } from '../adapter.js';
import { queryFromThread, section } from '../shared.js';

export function createGitHubAdapter(): IntegrationAdapter {
  const github = getGitHubService();
  return {
    id: 'github',
    name: 'GitHub',
    description: 'Issues, pull requests, and repository context.',
    credential: {
      authType: 'api_key',
      credentialKind: 'api_key',
      envKey: 'GITHUB_PAT',
      credentialLabel: 'Personal access token'
    },
    isConfigured: (workspaceId) => github.isConfigured(workspaceId),
    contextSources: [
      {
        name: 'github.thread_search',
        description: 'Search GitHub issues and pull requests by the current thread text.',
        optional: true,
        knowledgeDomains: ['code', 'documentation'],
        async retrieve(input) {
          const results = await github.search(queryFromThread(input), 3, input.workspace.id);
          return results.results.map((result) => githubToArtifact(result));
        }
      }
    ],
    tools: [
      {
        name: 'github.search',
        description: 'Search GitHub issues and pull requests by query text.',
        sideEffectClass: 'read',
        retrievalEligible: true,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' }
          }
        },
        knowledgeDomains: ['code', 'documentation'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { query: string; limit?: number }, context) {
          return await github.search(input.query, input.limit, context.workspace.id);
        }
      },
      {
        name: 'github.read_issue',
        description: 'Read a GitHub issue by repository and number.',
        sideEffectClass: 'read',
        retrievalEligible: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['repository', 'number'],
          properties: {
            repository: { type: 'string' },
            number: { type: 'number' }
          }
        },
        knowledgeDomains: ['code', 'documentation'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { repository: string; number: number }, context) {
          return await github.readIssue(input.repository, input.number, context.workspace.id);
        }
      },
      {
        name: 'github.read_pr',
        description: 'Read a GitHub pull request by repository and number.',
        sideEffectClass: 'read',
        retrievalEligible: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['repository', 'number'],
          properties: {
            repository: { type: 'string' },
            number: { type: 'number' }
          }
        },
        knowledgeDomains: ['code', 'documentation'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { repository: string; number: number }, context) {
          return await github.readPullRequest(input.repository, input.number, context.workspace.id);
        }
      }
    ],
    sessionContext: {
      async contribute(input) {
        const results = await github.search(`updated:${input.date}`, 5, input.workspace.id);
        return {
          sections: results.results.map((item) => section('github', item.title, item.body ?? item.title, {
            url: item.url,
            metadata: { repository: item.repository, number: item.number, kind: item.kind }
          }))
        };
      }
    }
  };
}

