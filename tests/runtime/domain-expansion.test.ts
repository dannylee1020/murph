import { describe, expect, it } from 'vitest';
import { domainExpansionMap, expandContextSourcesByDomain, expandToolsByDomain } from '../../src/lib/server/runtime/domain-expansion';
import type { ContextSource, SkillManifest, ToolInventoryItem, WorkspaceMemory } from '../../src/lib/types';

const workspaceMemory: WorkspaceMemory = {
  workspaceId: 'workspace',
  channelMappings: [],
  escalationRules: [],
  enabledOptionalTools: ['notion.search', 'notion.read_page', 'confluence.search', 'docs.write'],
  enabledContextSources: ['notion.thread_search', 'confluence.thread_search'],
  enabledPlugins: []
};

function skill(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    name: 'documentation-grounded-continuity',
    description: '',
    triggers: ['readiness'],
    allowedActions: ['reply', 'ask', 'redirect', 'defer', 'remind', 'abstain'],
    toolNames: ['channel.fetch_thread', 'memory.thread.read'],
    knowledgeDomains: ['documentation'],
    channelNames: ['slack'],
    contextSourceNames: ['memory.linked_artifacts'],
    knowledgeRequirements: [],
    sessionModes: ['manual_review'],
    appliesTo: ['channel_thread'],
    priority: 120,
    riskLevel: 'low',
    abstainConditions: [],
    instructions: '',
    ...overrides
  };
}

function tool(input: Partial<ToolInventoryItem> & Pick<ToolInventoryItem, 'name' | 'sideEffectClass'>): ToolInventoryItem {
  return {
    description: input.name,
    optional: false,
    source: 'test',
    ...input
  };
}

function source(input: Pick<ContextSource, 'name'> & Partial<ContextSource>): Pick<ContextSource, 'name' | 'optional' | 'knowledgeDomains'> {
  return {
    optional: false,
    ...input
  };
}

const tools: ToolInventoryItem[] = [
  tool({ name: 'channel.fetch_thread', sideEffectClass: 'read' }),
  tool({ name: 'memory.thread.read', sideEffectClass: 'read' }),
  tool({
    name: 'notion.search',
    sideEffectClass: 'read',
    requiresWorkspaceEnablement: true,
    optional: true,
    knowledgeDomains: ['documentation']
  }),
  tool({
    name: 'notion.read_page',
    sideEffectClass: 'read',
    requiresWorkspaceEnablement: true,
    optional: true,
    knowledgeDomains: ['documentation']
  }),
  tool({
    name: 'confluence.search',
    sideEffectClass: 'read',
    requiresWorkspaceEnablement: true,
    optional: true,
    knowledgeDomains: ['documentation']
  }),
  tool({
    name: 'github.search',
    sideEffectClass: 'read',
    requiresWorkspaceEnablement: true,
    optional: true,
    knowledgeDomains: ['code']
  }),
  tool({
    name: 'docs.write',
    sideEffectClass: 'write',
    requiresWorkspaceEnablement: true,
    optional: true,
    knowledgeDomains: ['documentation']
  })
];

describe('domain expansion', () => {
  it('prioritizes enabled domain retrieval tools over already-preloaded context tools', () => {
    const expanded = expandToolsByDomain({
      selectedSkills: [skill()],
      allTools: tools,
      workspaceMemory
    });

    expect(expanded.map((entry) => entry.name)).toEqual([
      'notion.search',
      'notion.read_page',
      'confluence.search'
    ]);
  });

  it('does not expose disabled domain tools, mismatched domains, or write tools', () => {
    const expanded = expandToolsByDomain({
      selectedSkills: [skill()],
      allTools: tools,
      workspaceMemory: {
        ...workspaceMemory,
        enabledOptionalTools: ['notion.search', 'docs.write', 'github.search']
      }
    });

    expect(expanded.map((entry) => entry.name)).toEqual(['notion.search']);
  });

  it('keeps explicit context tools when no domain retrieval tools are available', () => {
    const expanded = expandToolsByDomain({
      selectedSkills: [skill()],
      allTools: tools,
      workspaceMemory: {
        ...workspaceMemory,
        enabledOptionalTools: []
      }
    });

    expect(expanded.map((entry) => entry.name)).toEqual(['channel.fetch_thread', 'memory.thread.read']);
  });

  it('reports tools added through domain expansion', () => {
    const expanded = expandToolsByDomain({
      selectedSkills: [skill()],
      allTools: tools,
      workspaceMemory
    });

    expect(domainExpansionMap({ selectedSkills: [skill()], availableTools: expanded })).toEqual({
      documentation: ['notion.search', 'notion.read_page', 'confluence.search']
    });
  });

  it('expands enabled context sources by selected skill domain', () => {
    const expanded = expandContextSourcesByDomain({
      selectedSkills: [skill()],
      allSources: [
        source({ name: 'memory.linked_artifacts', knowledgeDomains: ['documentation'] }),
        source({ name: 'notion.thread_search', optional: true, knowledgeDomains: ['documentation'] }),
        source({ name: 'confluence.thread_search', optional: true, knowledgeDomains: ['documentation'] }),
        source({ name: 'github.thread_search', optional: true, knowledgeDomains: ['code'] })
      ],
      workspaceMemory
    });

    expect(expanded).toEqual(['memory.linked_artifacts', 'notion.thread_search', 'confluence.thread_search']);
  });
});
