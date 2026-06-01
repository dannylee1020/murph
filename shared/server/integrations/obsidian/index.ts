import {
  getObsidianConnectionStatus,
  isObsidianConfigured,
  readObsidianNote,
  searchObsidianNotes,
  toArtifact as obsidianToArtifact
} from '#shared/server/context-sources/obsidian';
import type { IntegrationAdapter } from '../adapter.js';
import { queryFromThread } from '../shared.js';

export function createObsidianAdapter(): IntegrationAdapter {
  return {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Local Markdown vault notes and knowledge base context.',
    distributions: ['personal'],
    credential: {
      authType: 'path',
      credentialKind: 'config_path',
      envKey: 'OBSIDIAN_VAULT_PATH',
      credentialLabel: 'Vault path'
    },
    isConfigured: () => isObsidianConfigured(),
    contextSources: [
      {
        name: 'obsidian.thread_search',
        description: 'Search a connected Obsidian vault by the current thread text.',
        optional: true,
        knowledgeDomains: ['documentation', 'meeting'],
        async retrieve(input) {
          if (!getObsidianConnectionStatus().configured) {
            return [];
          }
          const results = await searchObsidianNotes(queryFromThread(input), 3);
          return results.map((result) => obsidianToArtifact(result));
        }
      }
    ],
    tools: [
      {
        name: 'obsidian.search',
        description: 'Search a connected Obsidian vault by query text.',
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
        knowledgeDomains: ['documentation', 'meeting'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { query: string; limit?: number }) {
          return { results: await searchObsidianNotes(input.query, input.limit ?? 3) };
        }
      },
      {
        name: 'obsidian.read_note',
        description: 'Read a connected Obsidian note by vault-relative path.',
        sideEffectClass: 'read',
        retrievalEligible: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['path'],
          properties: {
            path: { type: 'string' }
          }
        },
        knowledgeDomains: ['documentation', 'meeting'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { path: string }) {
          return await readObsidianNote(input.path);
        }
      }
    ]
  };
}
