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
  it('renders channel reply style guidance', () => {
    const prompt = buildGroundingPrompt(context());
    expect(prompt).toContain('Write like a teammate in the channel, not a chatbot.');
    expect(prompt).toContain('Use simple words and 1-3 short sentences by default.');
    expect(prompt).toContain('Lead with the answer or status, not setup phrases.');
    expect(prompt).toContain('If uncertain, say what is missing and defer instead of padding.');
  });

  it('lists each available tool with its description', () => {
    const prompt = buildGroundingPrompt(context());
    expect(prompt).toContain('Retrieval is all-or-nothing');
    expect(prompt).toContain('- notion.search (documentation): Search documentation');
  });

  it('inserts a strict directive when grounding is required', () => {
    const prompt = buildGroundingPrompt(context(), requiredDirective);
    expect(prompt).toContain('First decide whether the triggerMessage is a real Murph request');
    expect(prompt).toContain('call runtime.retrieve_all exactly once before drafting');
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
    expect(prompt).toContain('The triggerMessage in the task is the current request and the primary authority.');
    expect(prompt).toContain('Current-run artifacts may include broad fanout results from connected read-only sources');
    expect(prompt).toContain('If sources conflict, say which source says what instead of guessing.');
    expect(prompt).toContain('do not answer factual or current-state questions from thread memory alone');
  });

});
