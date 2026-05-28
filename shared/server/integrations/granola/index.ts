import { getGranolaService, toArtifact as granolaToArtifact } from '#shared/server/context-sources/granola';
import type { IntegrationAdapter } from '../adapter.js';
import { queryFromThread } from '../shared.js';

export function createGranolaAdapter(): IntegrationAdapter {
  const granola = getGranolaService();
  return {
    id: 'granola',
    name: 'Granola',
    description: 'Meeting notes and transcripts.',
    credential: {
      authType: 'api_key',
      credentialKind: 'api_key',
      envKey: 'GRANOLA_API_KEY',
      credentialLabel: 'API key'
    },
    isConfigured: () => granola.isConfigured(),
    contextSources: [
      {
        name: 'granola.thread_search',
        description: 'Search Granola meeting notes by the current thread text.',
        optional: true,
        knowledgeDomains: ['meeting'],
        async retrieve(input) {
          const results = await granola.search(queryFromThread(input), 3);
          return results.results.map((result) => granolaToArtifact(result));
        }
      }
    ],
    tools: [
      {
        name: 'granola.search',
        description: 'Search Granola meeting notes by query text.',
        sideEffectClass: 'read',
        retrievalEligible: true,
        retrieval: { profile: 'team_discussion' },
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' }
          }
        },
        knowledgeDomains: ['meeting'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { query: string; limit?: number }) {
          return await granola.search(input.query, input.limit);
        }
      },
      {
        name: 'granola.read_meeting',
        description: 'Read a Granola meeting note by ID.',
        sideEffectClass: 'read',
        retrievalEligible: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['noteId'],
          properties: {
            noteId: { type: 'string' }
          }
        },
        knowledgeDomains: ['meeting'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { noteId: string }) {
          return await granola.readMeeting(input.noteId, true);
        }
      }
    ]
  };
}
