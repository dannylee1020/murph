import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/lib/server/runtime/policy';
import type { AutopilotSession, ContextAssembly, ProposedAction } from '../src/lib/types';

function context(overrides: Partial<ContextAssembly> = {}): ContextAssembly {
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
    skills: [
      {
        name: 'channel-continuity',
        description: '',
        sessionModes: ['manual_review', 'auto_send_low_risk', 'dry_run'],
        priority: 1,
        riskLevel: 'low',
        instructions: ''
      }
    ],
    availableTools: [],
    unresolvedQuestions: [],
    continuityCase: 'clarification',
    linkedArtifacts: [],
    ...overrides
  };
}

function session(mode: AutopilotSession['mode']): AutopilotSession {
  return {
    id: 'session',
    workspaceId: 'workspace',
    ownerSlackUserId: 'U1',
    title: 'Overnight',
    mode,
    status: 'active',
    channelScope: [],
    startedAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 60_000).toISOString()
  };
}

function action(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    type: 'reply',
    message: 'Here is the status.',
    reason: 'Grounded response',
    confidence: 0.9,
    ...overrides
  };
}

describe('evaluatePolicy', () => {
  it('abstains for forbidden topics', () => {
    const decision = evaluatePolicy(action(), context({ memory: { ...context().memory, user: { userId: 'U1', preferences: [], forbiddenTopics: ['payroll'], routingHints: [] } }, thread: { ...context().thread, latestMessage: 'payroll question' } }), session('manual_review'));
    expect(decision.disposition).toBe('abstained');
  });

  it('abstains for empty or unknown context and low confidence', () => {
    expect(evaluatePolicy(action(), context({ thread: { ...context().thread, latestMessage: '' } }), session('manual_review')).reason).toMatch(/Empty/);
    expect(evaluatePolicy(action(), context({ continuityCase: 'unknown' }), session('manual_review')).reason).toMatch(/out of scope/);
    expect(evaluatePolicy(action({ confidence: 0.4 }), context(), session('manual_review')).reason).toMatch(/confidence/);
  });

  it('requires message bodies and redirect participants', () => {
    expect(evaluatePolicy(action({ message: '' }), context(), session('auto_send_low_risk')).disposition).toBe('abstained');
    expect(evaluatePolicy(action({ type: 'redirect' }), context({ thread: { ...context().thread, participants: ['U1'] } }), session('auto_send_low_risk')).downgradedTo).toBe('ask');
  });

  it('maps session modes and risk to dispositions', () => {
    expect(evaluatePolicy(action(), context(), session('dry_run')).disposition).toBe('abstained');
    expect(evaluatePolicy(action(), context(), session('manual_review')).disposition).toBe('queued');
    expect(evaluatePolicy(action({ type: 'remind' }), context(), session('manual_review')).disposition).toBe('scheduled');
    expect(
      evaluatePolicy(
        action(),
        context({ skills: [{ ...context().skills[0], riskLevel: 'high' }] }),
        session('auto_send_low_risk')
    ).disposition
    ).toBe('queued');
    expect(evaluatePolicy(action(), context(), session('auto_send_low_risk')).disposition).toBe('auto_sent');
  });

  it('applies compiled policy rules before auto-send', () => {
    const compiledPolicyContext = context({
      memory: {
        ...context().memory,
        user: {
          userId: 'U1',
          preferences: [],
          forbiddenTopics: [],
          routingHints: [],
          policy: {
            raw: 'Allow auto-send: no',
            compiled: {
              blockedTopics: [],
              alwaysQueueTopics: ['launch decisions'],
              blockedActions: [],
              requireGroundingForFacts: true,
              preferAskWhenUncertain: true,
              allowAutoSend: false,
              notesForAgent: []
            },
            compiledAt: new Date().toISOString(),
            source: 'operator_prompt',
            version: 1
          }
        }
      },
      thread: { ...context().thread, latestMessage: 'Need a launch decisions update' }
    });

    expect(evaluatePolicy(action(), compiledPolicyContext, session('auto_send_low_risk')).disposition).toBe('queued');
    expect(
      evaluatePolicy(
        action({ confidence: 0.7 }),
        context({
          memory: compiledPolicyContext.memory,
          thread: { ...context().thread, latestMessage: 'Simple continuity question' },
          artifacts: [{ id: 'a1', source: 'notion', type: 'document', title: 'Doc', text: 'Ready' }]
        }),
        session('auto_send_low_risk')
      ).downgradedTo
    ).toBe('ask');
    expect(
      evaluatePolicy(
        action(),
        context({
          memory: compiledPolicyContext.memory,
          thread: { ...context().thread, latestMessage: 'Simple continuity question' },
          artifacts: []
        }),
        session('auto_send_low_risk')
      ).reason
    ).toMatch(/grounded facts/);
  });
});
