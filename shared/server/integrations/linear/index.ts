import { getLinearService, toArtifact as linearToArtifact } from '#shared/server/context-sources/linear';
import { buildRetrievalQuery } from '#shared/server/util/retrieval-query';
import type { IntegrationAdapter } from '../adapter.js';
import { queryFromThread } from '../shared.js';

export function createLinearAdapter(): IntegrationAdapter {
  const linear = getLinearService();
  return {
    id: 'linear',
    name: 'Linear',
    description: 'Shared issues, projects, and product work.',
    distributions: ['team'],
    credential: {
      authType: 'api_key',
      credentialKind: 'api_key',
      envKey: 'LINEAR_API_KEY',
      credentialLabel: 'Linear API key'
    },
    isConfigured: (workspaceId) => linear.isConfigured(workspaceId),
    contextSources: [
      {
        name: 'linear.thread_search',
        description: 'Search Linear issues by the current thread text.',
        optional: true,
        knowledgeDomains: ['project', 'coordination'],
        async retrieve(input) {
          const query = buildRetrievalQuery(queryFromThread(input));
          const results = await linear.searchIssues(query, 5, input.workspace.id);
          return results.results.map((result) => linearToArtifact(result));
        }
      }
    ],
    tools: [
      {
        name: 'linear.search_issues',
        description: 'Search Linear issues by title, description, or identifier.',
        sideEffectClass: 'read',
        retrievalEligible: true,
        retrieval: { profile: 'work_item' },
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' }
          }
        },
        knowledgeDomains: ['project', 'coordination'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { query: string; limit?: number }, context) {
          return await linear.searchIssues(input.query, input.limit, context.workspace.id);
        }
      },
      {
        name: 'linear.read_issue',
        description: 'Read a Linear issue by UUID or issue identifier.',
        sideEffectClass: 'read',
        retrievalEligible: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['issueId'],
          properties: {
            issueId: { type: 'string' }
          }
        },
        knowledgeDomains: ['project', 'coordination'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { issueId: string }, context) {
          return await linear.readIssue(input.issueId, context.workspace.id);
        }
      }
    ]
  };
}
