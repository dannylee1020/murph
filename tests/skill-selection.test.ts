import { describe, expect, it } from 'vitest';
import { selectSkills, triggerScore } from '../src/lib/server/skills/selection';
import type { SkillManifest, WorkspaceMemory } from '../src/lib/types';

function skill(input: Partial<SkillManifest> & { name: string; triggers: string[]; priority: number }): SkillManifest {
  return {
    description: input.name,
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

describe('triggerScore', () => {
  it('matches normalized trigger phrases on word boundaries', () => {
    expect(triggerScore('Can you check the design spec?', ['spec'])).toBe(1);
    expect(triggerScore('Can you inspect this?', ['spec'])).toBe(0);
  });

  it('supports explicit regex triggers', () => {
    expect(triggerScore('RFC-123 is blocked', ['regex:RFC-\\d+'])).toBe(1);
  });

  it('matches documentation phrases without matching casual note usage', () => {
    expect(triggerScore('The answer should be in the checkout launch readiness note.', ['readiness'])).toBe(1);
    expect(triggerScore('Please check the source of truth.', ['regex:\\bsource of truth\\b'])).toBe(1);
    expect(triggerScore('I noticed the launch changed.', ['note'])).toBe(0);
  });
});

describe('selectSkills', () => {
  it('always includes the fallback channel continuity skill', () => {
    const selected = selectSkills({
      skills: [skill({ name: 'channel-continuity', triggers: ['status'], priority: 100 })],
      latestMessage: 'hello',
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual(['channel-continuity']);
  });

  it('prefers documentation skill for source-of-truth prompts', () => {
    const selected = selectSkills({
      skills: [
        skill({ name: 'channel-continuity', triggers: ['status'], priority: 100 }),
        skill({
          name: 'documentation-grounded-continuity',
          triggers: ['readiness', 'regex:\\bsource of truth\\b'],
          priority: 120,
          knowledgeDomains: ['documentation']
        })
      ],
      latestMessage: 'The answer should be in the checkout launch readiness note.',
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual(['documentation-grounded-continuity', 'channel-continuity']);
  });

  it('prefers documentation skill for natural go-live decision prompts', () => {
    const selected = selectSkills({
      skills: [
        skill({ name: 'channel-continuity', triggers: ['status'], priority: 100 }),
        skill({
          name: 'documentation-grounded-continuity',
          triggers: ['go live', 'clear to go live', 'hold', 'signoff', 'approval', 'decision'],
          priority: 120,
          knowledgeDomains: ['documentation']
        })
      ],
      latestMessage: '<@UOWNER> are we clear to go live with checkout tomorrow morning, or should we hold?',
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual(['documentation-grounded-continuity', 'channel-continuity']);
  });

  it('matches adjacent launch approval language without requiring vendor terms', () => {
    const triggers = ['clear to launch', 'signoff', 'approval', 'ready tomorrow'];

    expect(triggerScore('Do we have signoff for checkout?', triggers)).toBe(1);
    expect(triggerScore('Is checkout ready tomorrow?', triggers)).toBe(1);
    expect(triggerScore('Are we clear to launch?', triggers)).toBe(1);
    expect(triggerScore('The launch copy changed a bit.', triggers)).toBe(0);
  });

  it('falls back when no documentation trigger fires', () => {
    const selected = selectSkills({
      skills: [
        skill({ name: 'channel-continuity', triggers: ['status'], priority: 100 }),
        skill({
          name: 'documentation-grounded-continuity',
          triggers: ['readiness', 'regex:\\b(runbook|playbook|handbook|guide|policy|notes)\\b'],
          priority: 120,
          knowledgeDomains: ['documentation']
        })
      ],
      latestMessage: 'I noticed the launch changed.',
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual(['channel-continuity']);
  });

  it('prefers meeting continuity over communication continuity when both match and scores tie', () => {
    const selected = selectSkills({
      skills: [
        skill({ name: 'channel-continuity', triggers: ['status'], priority: 100 }),
        skill({
          name: 'communication-grounded-continuity',
          triggers: ['customer call', 'recap'],
          priority: 110,
          knowledgeDomains: ['email', 'calendar', 'team']
        }),
        skill({
          name: 'meeting-grounded-continuity',
          triggers: ['customer call', 'recap'],
          priority: 115,
          knowledgeDomains: ['meeting', 'documentation']
        })
      ],
      latestMessage: 'Can you share the customer call recap?',
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)).toEqual([
      'meeting-grounded-continuity',
      'communication-grounded-continuity',
      'channel-continuity'
    ]);
  });

  it('lets trigger score beat priority when a communication prompt is more specific', () => {
    const selected = selectSkills({
      skills: [
        skill({ name: 'channel-continuity', triggers: ['status'], priority: 100 }),
        skill({
          name: 'communication-grounded-continuity',
          triggers: ['did we reply', 'latest email', 'did I send'],
          priority: 110,
          knowledgeDomains: ['email', 'calendar', 'team']
        }),
        skill({
          name: 'meeting-grounded-continuity',
          triggers: ['meeting', 'recap'],
          priority: 115,
          knowledgeDomains: ['meeting', 'documentation']
        })
      ],
      latestMessage: 'Did we reply in the latest email, and did I send a follow up after the meeting recap?',
      channel: 'slack',
      sessionMode: 'manual_review',
      tools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
      workspaceMemory
    });

    expect(selected.map((entry) => entry.name)[0]).toBe('communication-grounded-continuity');
  });
});
