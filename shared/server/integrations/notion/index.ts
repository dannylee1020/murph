import { getNotionService } from '#shared/server/context-sources/notion';
import type { IntegrationAdapter } from '../adapter.js';
import { queryFromThread } from '../shared.js';

export function createNotionAdapter(): IntegrationAdapter {
  const notion = getNotionService();
  return {
    id: 'notion',
    name: 'Notion',
    description: 'Team docs and knowledge pages.',
    credential: {
      authType: 'api_key',
      credentialKind: 'api_key',
      envKey: 'NOTION_API_KEY',
      credentialLabel: 'Integration token'
    },
    isConfigured: (workspaceId) => notion.isConfigured(workspaceId),
    contextSources: [
      {
        name: 'notion.thread_search',
        description: 'Search shared Notion pages by the current thread text.',
        optional: true,
        knowledgeDomains: ['documentation'],
        async retrieve(input) {
          const results = await notion.search(queryFromThread(input), 3, input.workspace.id);
          if (results.results.length === 0) {
            return [];
          }

          const [first, ...rest] = results.results;
          const page = await notion.readPage(first.id, 40, input.workspace.id);

          return [
            notion.toArtifact(page),
            ...rest.map((result) => notion.toArtifact(result))
          ];
        }
      }
    ],
    tools: [
      {
        name: 'notion.search',
        description: 'Search shared Notion pages by title and return matching page IDs, titles, and URLs.',
        sideEffectClass: 'read',
        retrievalEligible: true,
        retrieval: { profile: 'title_keywords' },
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' }
          }
        },
        knowledgeDomains: ['documentation'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { query: string; limit?: number }, context) {
          return await notion.search(input.query, input.limit, context.workspace.id);
        }
      },
      {
        name: 'notion.read_page',
        description: 'Read the first blocks of a shared Notion page as plain text.',
        sideEffectClass: 'read',
        retrievalEligible: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: {
            pageId: { type: 'string' },
            maxBlocks: { type: 'number' }
          }
        },
        knowledgeDomains: ['documentation'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { pageId: string; maxBlocks?: number }, context) {
          return await notion.readPage(input.pageId, input.maxBlocks, context.workspace.id);
        }
      }
    ]
  };
}
