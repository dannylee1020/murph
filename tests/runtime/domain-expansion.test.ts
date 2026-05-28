import { describe, expect, it } from 'vitest';
import { expandContextSources } from '../../shared/server/runtime/domain-expansion';
import type { ContextSource, SkillManifest, WorkspaceMemory } from '../../shared/types';

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
    name: 'notion-docs',
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

  it('fans out to all enabled optional sources when grounding is required', () => {
    const expanded = expandContextSources({
      selectedSkills: [skill({ knowledgeDomains: ['documentation'], groundingPolicy: 'required_when_no_artifacts' })],
      allSources: [
        source({ name: 'notion.thread_search', optional: true, knowledgeDomains: ['documentation'] }),
        source({ name: 'gmail.thread_search', optional: true, knowledgeDomains: ['email'] }),
        source({ name: 'github.thread_search', optional: true, knowledgeDomains: ['code'] })
      ],
      workspaceMemory: {
        ...workspaceMemory,
        enabledContextSources: ['notion.thread_search', 'gmail.thread_search', 'github.thread_search']
      }
    });

    expect(expanded).toEqual({
      explicit: [],
      optional: ['notion.thread_search', 'gmail.thread_search', 'github.thread_search']
    });
  });

});
