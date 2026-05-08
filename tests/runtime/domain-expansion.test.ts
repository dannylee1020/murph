import { describe, expect, it } from 'vitest';
import { expandContextSources } from '../../src/lib/server/runtime/domain-expansion';
import type { ContextSource, SkillManifest, WorkspaceMemory } from '../../src/lib/types';

const workspaceMemory: WorkspaceMemory = {
  workspaceId: 'workspace',
  channelMappings: [],
  escalationRules: [],
  enabledOptionalTools: [],
  enabledContextSources: ['notion.thread_search', 'confluence.thread_search', 'github.thread_search'],
  enabledPlugins: []
};

function skill(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    name: 'documentation-grounded-continuity',
    description: '',
    knowledgeDomains: ['documentation'],
    channelNames: ['slack'],
    contextSourceNames: ['memory.linked_artifacts'],
    sessionModes: ['manual_review'],
    priority: 120,
    riskLevel: 'low',
    instructions: '',
    ...overrides
  };
}

function source(input: Pick<ContextSource, 'name'> & Partial<ContextSource>): Pick<ContextSource, 'name' | 'optional' | 'knowledgeDomains'> {
  return {
    optional: false,
    ...input
  };
}

describe('expandContextSources', () => {
  it('expands enabled context sources matching selected skill domains', () => {
    const expanded = expandContextSources({
      selectedSkills: [skill()],
      allSources: [
        source({ name: 'memory.linked_artifacts', knowledgeDomains: ['documentation'] }),
        source({ name: 'notion.thread_search', optional: true, knowledgeDomains: ['documentation'] }),
        source({ name: 'confluence.thread_search', optional: true, knowledgeDomains: ['documentation'] }),
        source({ name: 'github.thread_search', optional: true, knowledgeDomains: ['code'] })
      ],
      workspaceMemory
    });

    expect(expanded).toEqual({
      explicit: ['memory.linked_artifacts'],
      optional: ['notion.thread_search', 'confluence.thread_search']
    });
  });

  it('skips optional sources whose workspace allowlist is empty', () => {
    const expanded = expandContextSources({
      selectedSkills: [skill()],
      allSources: [
        source({ name: 'notion.thread_search', optional: true, knowledgeDomains: ['documentation'] })
      ],
      workspaceMemory: { ...workspaceMemory, enabledContextSources: [] }
    });

    expect(expanded).toEqual({ explicit: [], optional: [] });
  });

  it('does not prefetch enabled sources from unrelated domains', () => {
    const expanded = expandContextSources({
      selectedSkills: [skill({ knowledgeDomains: ['documentation'] })],
      allSources: [
        source({ name: 'gmail.thread_search', optional: true, knowledgeDomains: ['email'] })
      ],
      workspaceMemory: {
        ...workspaceMemory,
        enabledContextSources: ['gmail.thread_search']
      }
    });

    expect(expanded).toEqual({ explicit: [], optional: [] });
  });
});
