import { describe, expect, it } from 'vitest';
import { selectSkills } from '../src/lib/server/skills/selection';
import type { SkillManifest, WorkspaceMemory } from '../src/lib/types';

function skill(input: Partial<SkillManifest> & { name: string; priority: number }): SkillManifest {
  return {
    description: input.name,
    triggers: [],
    allowedActions: ['reply', 'ask', 'redirect', 'defer', 'remind', 'abstain'],
    toolNames: ['channel.fetch_thread'],
    channelNames: ['slack'],
    contextSourceNames: ['memory.linked_artifacts'],
    knowledgeRequirements: [],
    sessionModes: ['manual_review'],
    appliesTo: ['channel_thread'],
    riskLevel: 'low',
    abstainConditions: [],
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
  it('always includes the fallback channel-continuity skill', () => {
    const selected = selectSkills({
      skills: [skill({ name: 'channel-continuity', priority: 100 })],
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual(['channel-continuity']);
  });

  it('includes every eligible skill regardless of message wording — composition is the goal', () => {
    const selected = selectSkills({
      skills: [
        skill({ name: 'channel-continuity', priority: 100 }),
        skill({
          name: 'documentation-grounded-continuity',
          priority: 120,
          knowledgeDomains: ['documentation']
        })
      ],
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual([
      'documentation-grounded-continuity',
      'channel-continuity'
    ]);
  });

  it('filters out skills whose channel does not match', () => {
    const selected = selectSkills({
      skills: [
        skill({ name: 'channel-continuity', priority: 100 }),
        skill({ name: 'discord-only-skill', priority: 110, channelNames: ['discord'] })
      ],
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual(['channel-continuity']);
  });

  it('filters out skills whose session mode does not match', () => {
    const selected = selectSkills({
      skills: [
        skill({ name: 'channel-continuity', priority: 100 }),
        skill({ name: 'dry-run-only', priority: 110, sessionModes: ['dry_run'] })
      ],
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual(['channel-continuity']);
  });

  it('drops skills that require unavailable tools but keeps the fallback', () => {
    const selected = selectSkills({
      skills: [
        skill({ name: 'channel-continuity', priority: 100 }),
        skill({
          name: 'needs-missing-tool',
          priority: 120,
          toolNames: ['channel.fetch_thread', 'integration.unavailable']
        })
      ],
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual(['channel-continuity']);
  });

  it('keeps skills whose required tool is available via the workspace optional allowlist', () => {
    const selected = selectSkills({
      skills: [
        skill({ name: 'channel-continuity', priority: 100 }),
        skill({
          name: 'documentation-grounded-continuity',
          priority: 120,
          toolNames: ['channel.fetch_thread', 'notion.search']
        })
      ],
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory: {
        ...workspaceMemory,
        enabledOptionalTools: ['notion.search']
      }
    });

    expect(selected.map((entry) => entry.name)).toEqual([
      'documentation-grounded-continuity',
      'channel-continuity'
    ]);
  });

  it('orders eligible skills by priority desc, breaking ties by name asc', () => {
    const selected = selectSkills({
      skills: [
        skill({ name: 'channel-continuity', priority: 100 }),
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
      'beta-skill',
      'channel-continuity'
    ]);
  });
});
