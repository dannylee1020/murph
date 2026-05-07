import { describe, expect, it } from 'vitest';
import { buildGroundingPrompt } from '../../src/lib/server/runtime/grounding-prompt';
import type { GroundingDirective } from '../../src/lib/server/runtime/tool-calling-plan';
import type { ContextAssembly } from '../../src/lib/types';

function context(overrides: Partial<Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>> = {}): Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'> {
  return {
    workspaceId: 'workspace',
    task: {
      id: 'task',
      source: 'slack_event',
      workspaceId: 'workspace',
      thread: { provider: 'slack', channelId: 'channel', threadTs: '1.0' },
      targetUserId: 'owner',
      receivedAt: new Date().toISOString()
    },
    targetUserId: 'owner',
    thread: {
      ref: { provider: 'slack', channelId: 'channel', threadTs: '1.0' },
      latestMessage: 'Are we clear to go live?',
      recentMessages: [],
      participants: []
    },
    memory: {
      user: { userId: 'owner', preferences: [], forbiddenTopics: [], routingHints: [] },
      workspace: {
        workspaceId: 'workspace',
        channelMappings: [],
        escalationRules: [],
        enabledOptionalTools: [],
        enabledContextSources: [],
        enabledPlugins: []
      },
      thread: {
        workspaceId: 'workspace',
        channelId: 'channel',
        threadTs: '1.0',
        linkedArtifacts: [],
        openQuestions: [],
        blockerNotes: []
      }
    },
    skills: [
      {
        name: 'documentation-grounded-continuity',
        description: 'Grounds replies in documentation.',
        knowledgeDomains: ['documentation'],
        groundingPolicy: 'required_when_no_artifacts',
        channelNames: ['slack'],
        sessionModes: ['manual_review'],
        priority: 1,
        riskLevel: 'low',
        instructions: 'Choose the best documentation tool before answering.'
      }
    ],
    availableTools: [
      {
        name: 'notion.search',
        description: 'Search documentation',
        sideEffectClass: 'read',
        knowledgeDomains: ['documentation']
      }
    ],
    linkedArtifacts: [],
    artifacts: [],
    ...overrides
  };
}

const requiredDirective: GroundingDirective = {
  required: true,
  reason: 'Skill "documentation-grounded-continuity" requires retrieval grounding before drafting because no current-run source evidence is present.'
};

describe('buildGroundingPrompt', () => {
  it('renders the murph identity preamble', () => {
    const prompt = buildGroundingPrompt(context());
    expect(prompt).toContain('You are Murph');
    expect(prompt).toContain('Return strict JSON');
  });

  it('renders each selected skill as a readable system block', () => {
    const prompt = buildGroundingPrompt(context());
    expect(prompt).toContain('## documentation-grounded-continuity');
    expect(prompt).toContain('Grounds replies in documentation.');
    expect(prompt).toContain('Choose the best documentation tool before answering.');
  });

  it('lists each available tool with its description', () => {
    const prompt = buildGroundingPrompt(context());
    expect(prompt).toContain('call several retrieval tools rather than just one');
    expect(prompt).toContain('- notion.search (documentation): Search documentation');
  });

  it('inserts a strict directive when grounding is required', () => {
    const prompt = buildGroundingPrompt(context(), requiredDirective);
    expect(prompt).toContain('You MUST call all relevant retrieval/search tools before drafting');
  });

  it('describes thread memory as context rather than source evidence', () => {
    const prompt = buildGroundingPrompt(context({
      memory: {
        ...context().memory,
        thread: {
          ...context().memory.thread,
          summary: 'Calendar says next Thursday is unavailable.'
        }
      }
    }));

    expect(prompt).toContain('Thread memory is conversation context, not source-of-truth evidence.');
    expect(prompt).toContain('do not answer factual or current-state questions from thread memory alone');
  });

  it('lets the model skip retrieval when not required', () => {
    const prompt = buildGroundingPrompt(context({
      linkedArtifacts: ['https://example.com/launch-plan'],
      artifacts: [{ id: 'a1', source: 'notion', type: 'document', title: 'Launch plan', text: 'Ready.' }]
    }));
    expect(prompt).not.toContain('You MUST call all relevant retrieval/search tools before drafting');
  });
});
