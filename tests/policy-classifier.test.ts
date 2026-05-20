import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyPolicyExecution } from '../src/lib/server/runtime/policy-classifier';
import type { AutopilotSession, ContextAssembly, ProposedAction } from '../src/lib/types';

const classifyPolicyExecutionMock = vi.hoisted(() => vi.fn());

vi.mock('#lib/server/providers/index', () => ({
  getPolicyModelProvider: () => ({
    classifyPolicyExecution: classifyPolicyExecutionMock
  })
}));

function context(): ContextAssembly {
  return {
    workspaceId: 'workspace',
    task: {
      id: 'task',
      source: 'slack_event',
      workspaceId: 'workspace',
      thread: { channelId: 'C1', threadTs: '1' },
      targetUserId: 'U1',
      receivedAt: new Date().toISOString()
    },
    targetUserId: 'U1',
    thread: {
      ref: { channelId: 'C1', threadTs: '1' },
      latestMessage: 'Can you clarify launch status?',
      recentMessages: [],
      participants: ['U1', 'U2']
    },
    memory: {
      user: { userId: 'U1', preferences: [], forbiddenTopics: [], routingHints: [] },
      workspace: {
        workspaceId: 'workspace',
        channelMappings: [],
        escalationRules: [],
        enabledOptionalTools: [],
        enabledContextSources: [],
        enabledPlugins: []
      },
      thread: { workspaceId: 'workspace', channelId: 'C1', threadTs: '1', linkedArtifacts: [], openQuestions: [], blockerNotes: [] }
    },
    artifacts: [],
    skills: [],
    availableTools: [],
    unresolvedQuestions: [],
    continuityCase: 'clarification',
    linkedArtifacts: [],
    summary: 'Launch status request'
  };
}

function session(): AutopilotSession {
  return {
    id: 'session',
    workspaceId: 'workspace',
    ownerUserId: 'U1',
    title: 'Overnight',
    mode: 'auto_send_low_risk',
    status: 'active',
    channelScope: [],
    policy: {
      raw: '',
      compiled: {
        blockedTopics: [],
        alwaysQueueTopics: [],
        blockedActions: [],
        requireGroundingForFacts: false,
        preferAskWhenUncertain: true,
        allowAutoSend: true,
        notesForAgent: []
      },
      compiledAt: new Date().toISOString(),
      source: 'profile',
      version: 2
    },
    startedAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 60_000).toISOString()
  };
}

function action(): ProposedAction {
  return {
    type: 'reply',
    message: 'Launch is on track.',
    reason: 'Answered from context.',
    confidence: 0.9
  };
}

describe('classifyPolicyExecution', () => {
  beforeEach(() => {
    classifyPolicyExecutionMock.mockReset();
  });

  it('downgrades low-confidence send decisions to queue', async () => {
    classifyPolicyExecutionMock.mockResolvedValue({
      execution: 'send',
      matchedTopics: [],
      matchedRuleIds: [],
      reason: 'Probably safe to send.',
      confidence: 0.4
    });

    await expect(classifyPolicyExecution(context(), session(), action())).resolves.toEqual({
      execution: 'queue',
      matchedTopics: [],
      matchedRuleIds: [],
      reason: 'Probably safe to send.',
      confidence: 0.4
    });
  });

  it('queues when the policy classifier fails', async () => {
    classifyPolicyExecutionMock.mockRejectedValue(new Error('model unavailable'));

    await expect(classifyPolicyExecution(context(), session(), action())).resolves.toEqual({
      execution: 'queue',
      matchedTopics: [],
      matchedRuleIds: [],
      reason: 'Policy execution classifier failed: model unavailable',
      confidence: 0
    });
  });
});
