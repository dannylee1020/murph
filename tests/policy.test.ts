import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/lib/server/runtime/policy';
import type { AutopilotSession, CompiledPolicy, ContextAssembly, ProposedAction } from '../src/lib/types';

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
        name: 'notion-docs',
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
  const compiledPolicy = {
    blockedTopics: [],
    alwaysQueueTopics: [],
    blockedActions: [],
    executionMode: mode === 'auto_send_low_risk' ? 'auto_send_low_risk' as const : 'manual_review' as const,
    requireGroundingForFacts: false,
    preferAskWhenUncertain: true,
    allowAutoSend: mode === 'auto_send_low_risk',
    notesForAgent: []
  };

  return {
    id: 'session',
    workspaceId: 'workspace',
    ownerUserId: 'U1',
    title: 'Overnight',
    mode,
    status: 'active',
    channelScope: [],
    policy: {
      raw: '',
      compiled: compiledPolicy,
      compiledAt: new Date().toISOString(),
      source: mode === 'auto_send_low_risk' ? 'profile' : 'default',
      version: 2
    },
    startedAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 60_000).toISOString()
  };
}

function sessionWithPolicy(policy: NonNullable<AutopilotSession['policy']>['compiled']): AutopilotSession {
  return {
    ...session('auto_send_low_risk'),
    policy: {
      raw: '',
      compiled: policy,
      compiledAt: new Date().toISOString(),
      source: 'operator_prompt',
      version: 2
    }
  };
}

function sessionWithModeAndPolicy(
  mode: AutopilotSession['mode'],
  policy: CompiledPolicy
): AutopilotSession {
  return {
    ...session(mode),
    policy: {
      raw: '',
      compiled: policy,
      compiledAt: new Date().toISOString(),
      source: 'profile',
      version: 2
    }
  };
}

function yoloPolicy(): CompiledPolicy {
  return {
    blockedTopics: [],
    alwaysQueueTopics: [],
    blockedActions: [],
    executionMode: 'auto_send_low_risk',
    requireGroundingForFacts: true,
    preferAskWhenUncertain: false,
    allowAutoSend: true,
    notesForAgent: ['use every materially relevant read-only retrieval and context tool before answering factual questions']
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

  it('abstains for empty or unknown context', () => {
    expect(evaluatePolicy(action(), context({ thread: { ...context().thread, latestMessage: '' } }), session('manual_review')).reason).toMatch(/Empty/);
    expect(evaluatePolicy(action(), context({ continuityCase: 'unknown' }), session('manual_review')).reason).toMatch(/out of scope/);
  });

  it('requires message bodies and redirect participants', () => {
    expect(evaluatePolicy(action({ message: '' }), context(), session('auto_send_low_risk')).disposition).toBe('abstained');
    expect(evaluatePolicy(action({ type: 'redirect' }), context({ thread: { ...context().thread, participants: ['U1'] } }), session('auto_send_low_risk')).downgradedTo).toBe('ask');
  });

  it('maps session modes and risk to dispositions', () => {
    expect(evaluatePolicy(action(), context(), session('dry_run')).disposition).toBe('abstained');
    expect(evaluatePolicy(action(), context(), session('dry_run')).execution).toBe('abstain');
    expect(evaluatePolicy(action(), context(), session('manual_review')).disposition).toBe('queued');
    expect(evaluatePolicy(action(), context(), session('manual_review')).execution).toBe('queue');
    expect(evaluatePolicy(action({ type: 'remind' }), context(), session('manual_review')).disposition).toBe('queued');
    expect(
      evaluatePolicy(
        action(),
        context({ skills: [{ ...context().skills[0], riskLevel: 'high' }] }),
        session('auto_send_low_risk')
    ).disposition
    ).toBe('queued');
    expect(evaluatePolicy(action(), context(), session('auto_send_low_risk')).disposition).toBe('auto_sent');
    expect(evaluatePolicy(action(), context(), session('auto_send_low_risk')).execution).toBe('send');
  });

  it('applies compiled policy rules before auto-send', () => {
    const compiledPolicyContext = context({
      thread: { ...context().thread, latestMessage: 'Need a launch decisions update' }
    });
    const policySession = sessionWithPolicy({
      blockedTopics: [],
      alwaysQueueTopics: ['launch decisions'],
      blockedActions: [],
      executionMode: 'manual_review',
      requireGroundingForFacts: true,
      preferAskWhenUncertain: true,
      allowAutoSend: false,
      notesForAgent: []
    });

    expect(evaluatePolicy(action(), compiledPolicyContext, policySession).disposition).toBe('queued');
    expect(evaluatePolicy(action({ confidence: 0.7 }), context(), policySession).reason).toMatch(/manual-review mode/);
  });

  it('applies channel-scoped rules before auto-send', () => {
    const decision = evaluatePolicy(
      action(),
      context({ artifacts: [{ id: 'doc', source: 'notion', type: 'document', title: 'Status', text: 'Ready' }] }),
      sessionWithPolicy({
        blockedTopics: [],
        alwaysQueueTopics: [],
        blockedActions: [],
        executionMode: 'auto_send_low_risk',
        requireGroundingForFacts: false,
        preferAskWhenUncertain: false,
        allowAutoSend: true,
        notesForAgent: [],
        rules: [
          {
            id: 'launch-channel-review',
            name: 'Launch channel review',
            match: { channelIds: ['C1'] },
            controls: { allowAutoSend: false }
          }
        ]
      })
    );

    expect(decision.disposition).toBe('queued');
    expect(decision.reason).toMatch(/manual-review mode/);
  });

  it('does not evaluate yolo grounding in policy', () => {
    const decision = evaluatePolicy(
      action({ confidence: 0.9 }),
      context({ artifacts: [] }),
      sessionWithModeAndPolicy('auto_send_low_risk', yoloPolicy())
    );

    expect(decision.disposition).toBe('auto_sent');
    expect(decision.execution).toBe('send');
  });

  it('uses the post-agent policy classifier for the final send queue abstain decision', () => {
    const autoSession = session('auto_send_low_risk');

    expect(
      evaluatePolicy(action(), context(), autoSession, {
        execution: 'queue',
        matchedTopics: [],
        matchedRuleIds: [],
        reason: 'Policy wants operator review.',
        confidence: 0.93
      })
    ).toEqual(expect.objectContaining({
      disposition: 'queued',
      execution: 'queue',
      reason: 'Policy wants operator review.'
    }));

    expect(
      evaluatePolicy(action(), context(), autoSession, {
        execution: 'abstain',
        matchedTopics: ['payroll'],
        matchedRuleIds: [],
        reason: 'Policy blocks this request.',
        confidence: 0.93
      })
    ).toEqual(expect.objectContaining({
      disposition: 'abstained',
      execution: 'abstain',
      reason: 'Policy blocks this request.'
    }));

    expect(
      evaluatePolicy(action(), context(), autoSession, {
        execution: 'send',
        matchedTopics: [],
        matchedRuleIds: [],
        reason: 'Policy allows sending.',
        confidence: 0.93
      }).execution
    ).toBe('send');
  });

  it('keeps deterministic gates authoritative over classifier send decisions', () => {
    const classifierSend = {
      execution: 'send' as const,
      matchedTopics: [],
      matchedRuleIds: [],
      reason: 'Policy allows sending.',
      confidence: 0.93
    };

    expect(evaluatePolicy(action(), context(), session('manual_review'), classifierSend).execution).toBe('queue');
    expect(evaluatePolicy(action(), context(), session('dry_run'), classifierSend).execution).toBe('abstain');
    expect(
      evaluatePolicy(
        action(),
        context({ thread: { ...context().thread, latestMessage: 'Can you review payroll details?' } }),
        sessionWithPolicy({
          blockedTopics: ['payroll'],
          alwaysQueueTopics: [],
          blockedActions: [],
          executionMode: 'auto_send_low_risk',
          requireGroundingForFacts: true,
          preferAskWhenUncertain: true,
          allowAutoSend: true,
          notesForAgent: []
        }),
        classifierSend
      ).execution
    ).toBe('abstain');
  });

  it('allows grounded yolo auto-send only when session mode does not temporarily restrict it', () => {
    const groundedContext = context({
      artifacts: [{ id: 'a1', source: 'notion', type: 'document', title: 'Status', text: 'Ready' }]
    });

    expect(
      evaluatePolicy(
        action({ confidence: 0.7 }),
        groundedContext,
        sessionWithModeAndPolicy('auto_send_low_risk', yoloPolicy())
      ).disposition
    ).toBe('auto_sent');

    expect(
      evaluatePolicy(
        action({ confidence: 0.7 }),
        groundedContext,
        sessionWithModeAndPolicy('manual_review', yoloPolicy())
      ).disposition
    ).toBe('queued');

    expect(
      evaluatePolicy(
        action({ confidence: 0.7 }),
        groundedContext,
        sessionWithModeAndPolicy('dry_run', yoloPolicy())
      ).disposition
    ).toBe('abstained');
  });

});
