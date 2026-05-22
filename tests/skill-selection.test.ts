import { describe, expect, it } from 'vitest';
import { selectSkills } from '../src/lib/server/skills/selection';
import type { SkillManifest, WorkspaceMemory } from '../src/lib/types';

function skill(input: Partial<SkillManifest> & { name: string; priority: number }): SkillManifest {
  return {
    description: input.name,
    channelNames: ['slack'],
    contextSourceNames: ['memory.linked_artifacts'],
    sessionModes: ['manual_review'],
    riskLevel: 'low',
    instructions: '',
    ...input
  };
}

const workspaceMemory: WorkspaceMemory = {
  workspaceId: 'workspace',
  channelMappings: [],
  escalationRules: [],
  enabledOptionalTools: [],
  enabledContextSources: [],
  enabledPlugins: []
};

describe('selectSkills', () => {
  it('returns an empty selection when no integration skills are eligible', () => {
    const selected = selectSkills({
      skills: [
        skill({
          name: 'notion-docs',
          priority: 120,
          contextSourceNames: ['notion.thread_search']
        })
      ],
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual([]);
  });

  it('includes every eligible skill regardless of message wording — composition is the goal', () => {
    const selected = selectSkills({
      skills: [
        skill({
          name: 'notion-docs',
          priority: 120,
          knowledgeDomains: ['documentation'],
          contextSourceNames: ['memory.linked_artifacts']
        })
      ],
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual([
      'notion-docs'
    ]);
  });

  it('drops skills that require unavailable context sources', () => {
    const selected = selectSkills({
      skills: [
        skill({
          name: 'needs-missing-source',
          priority: 120,
          contextSourceNames: ['notion.thread_search']
        })
      ],
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual([]);
  });

  it('keeps skills whose required context source is enabled in workspace memory', () => {
    const selected = selectSkills({
      skills: [
        skill({
          name: 'notion-docs',
          priority: 120,
          contextSourceNames: ['notion.thread_search']
        })
      ],
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory: {
        ...workspaceMemory,
        enabledContextSources: ['notion.thread_search']
      }
    });

    expect(selected.map((entry) => entry.name)).toEqual([
      'notion-docs'
    ]);
  });

  it('orders eligible skills by priority desc, breaking ties by name asc', () => {
    const selected = selectSkills({
      skills: [
        skill({ name: 'beta-skill', priority: 110 }),
        skill({ name: 'alpha-skill', priority: 110 }),
        skill({ name: 'gamma-skill', priority: 120 })
      ],
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual([
      'gamma-skill',
      'alpha-skill',
      'beta-skill'
    ]);
  });
});
