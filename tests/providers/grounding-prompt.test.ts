import { describe, expect, it } from 'vitest';
import { buildGroundingPrompt } from '../../src/lib/server/runtime/grounding-prompt';
import type { RuntimeRetrievalPlan } from '../../src/lib/server/runtime/tool-calling-plan';
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
        description: '',
        triggers: [],
        allowedActions: ['reply', 'ask', 'redirect', 'defer', 'remind', 'abstain'],
        toolNames: [],
        knowledgeDomains: ['documentation'],
        groundingPolicy: 'required_when_no_artifacts',
        channelNames: ['slack'],
        contextSourceNames: [],
        knowledgeRequirements: [],
        sessionModes: ['manual_review'],
        appliesTo: ['channel_thread'],
        priority: 1,
        riskLevel: 'low',
        abstainConditions: [],
        instructions: ''
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

const retrievalRequired: RuntimeRetrievalPlan = {
  required: true,
  reason: 'Current context is insufficient for a factual answer; retrieval should be attempted before drafting.',
  questionKind: 'factual_status',
  preferredDomains: ['documentation'],
  failureDisposition: 'queue_review'
};

describe('buildGroundingPrompt', () => {
  it('requires a search tool call when required-grounding skills have no artifacts', () => {
    const prompt = buildGroundingPrompt(context(), retrievalRequired);

    expect(prompt).toContain('You MUST call a relevant retrieval/search tool before drafting');
    expect(prompt).toContain('"name":"notion.search"');
  });

  it('allows a no-tool answer when grounding is not required', () => {
    const prompt = buildGroundingPrompt(context({
      artifacts: [{ id: 'artifact-1', source: 'notion', type: 'document', title: 'Launch plan', text: 'Ready.' }]
    }));

    expect(prompt).toContain('If the provided context is already sufficient, answer without calling tools.');
    expect(prompt).not.toContain('You MUST call a relevant search tool before drafting');
  });
});
