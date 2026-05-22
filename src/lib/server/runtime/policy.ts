import { DEFAULT_AUTO_SEND_ACTIONS } from '#lib/config';
import type {
  AutopilotSession,
  CompiledPolicy,
  ContextAssembly,
  ContinuityActionType,
  PolicyControls,
  PolicyDecision,
  PolicyExecutionDecision,
  ProposedAction
} from '#lib/types';
import {
  builtinPolicyProfile,
  normalizeCompiledPolicy,
  policyExecutionModeFromAllowAutoSend
} from '#lib/server/runtime/policy-compiler';

const AUTO_SEND_ACTIONS = new Set<ContinuityActionType>(DEFAULT_AUTO_SEND_ACTIONS);

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function ruleMatches(
  rule: NonNullable<CompiledPolicy['rules']>[number],
  action: ProposedAction,
  context: ContextAssembly
): boolean {
  const channelId = context.task.thread.channelId || context.thread.ref.channelId;
  const match = rule.match;
  const channelMatches = !match.channelIds?.length || match.channelIds.includes(channelId);
  const intentMatches = !match.intents?.length || match.intents.includes(context.continuityCase);
  const actionMatches = !match.actionTypes?.length || match.actionTypes.includes(action.type);
  return channelMatches && intentMatches && actionMatches;
}

function ruleSpecificity(rule: NonNullable<CompiledPolicy['rules']>[number]): number {
  return (
    (rule.match.channelIds?.length ? 4 : 0) +
    (rule.match.intents?.length ? 2 : 0) +
    (rule.match.actionTypes?.length ? 1 : 0)
  );
}

function applyControls(base: CompiledPolicy, controls: PolicyControls): CompiledPolicy {
  const executionMode =
    controls.executionMode ??
    (controls.allowAutoSend !== undefined
      ? policyExecutionModeFromAllowAutoSend(controls.allowAutoSend)
      : base.executionMode);
  return normalizeCompiledPolicy({
    blockedTopics: unique([...base.blockedTopics, ...(controls.blockedTopics ?? [])]),
    alwaysQueueTopics: unique([...base.alwaysQueueTopics, ...(controls.alwaysQueueTopics ?? [])]),
    blockedActions: [...new Set([...base.blockedActions, ...(controls.blockedActions ?? [])])],
    executionMode,
    requireGroundingForFacts: controls.requireGroundingForFacts ?? base.requireGroundingForFacts,
    preferAskWhenUncertain: controls.preferAskWhenUncertain ?? base.preferAskWhenUncertain,
    allowAutoSend: executionMode === 'auto_send_low_risk',
    notesForAgent: unique([...base.notesForAgent, ...(controls.notesForAgent ?? [])]),
    rules: base.rules
  });
}

function resolveRuntimePolicy(
  policy: CompiledPolicy | undefined,
  action: ProposedAction,
  context: ContextAssembly
): CompiledPolicy | undefined {
  if (!policy) {
    return undefined;
  }

  return [...(policy.rules ?? [])]
    .filter((rule) => ruleMatches(rule, action, context))
    .sort((left, right) => ruleSpecificity(left) - ruleSpecificity(right))
    .reduce<CompiledPolicy>((effective, rule) => applyControls(effective, rule.controls), {
      ...policy,
      rules: policy.rules
    });
}

export function resolvePolicyForRequest(context: ContextAssembly, session: AutopilotSession): CompiledPolicy {
  return resolveRuntimePolicy(
    session.policy?.compiled ?? builtinPolicyProfile(session.mode).compiled,
    {
      type: 'abstain',
      message: '',
      reason: 'Policy request evaluation',
      confidence: 1
    },
    context
  ) ?? builtinPolicyProfile(session.mode).compiled;
}

function topicMatches(text: string, topic: string): boolean {
  const normalized = topic.trim().toLowerCase();
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|\\b)${escaped}(\\b|$)`, 'i').test(text);
}

function forbiddenTopicsFor(context: ContextAssembly, policy: CompiledPolicy): string[] {
  return Array.from(new Set([...(context.memory.user?.forbiddenTopics ?? []), ...policy.blockedTopics]));
}

export function evaluatePolicy(
  action: ProposedAction,
  context: ContextAssembly,
  session: AutopilotSession,
  classifierDecision?: PolicyExecutionDecision
): PolicyDecision {
  const latestMessage = context.thread.latestMessage.trim().toLowerCase();
  const compiledPolicy = resolveRuntimePolicy(
    session.policy?.compiled ?? builtinPolicyProfile(session.mode).compiled,
    action,
    context
  );
  const forbiddenTopics = forbiddenTopicsFor(context, compiledPolicy ?? builtinPolicyProfile(session.mode).compiled);
  const hasHighRiskSkill = context.skills.some((skill) => skill.riskLevel === 'high');

  if (context.thread.latestMessage.trim().length === 0) {
    return {
      allowed: false,
      downgradedTo: 'abstain',
      disposition: 'abstained',
      execution: 'abstain',
      reason: 'Empty thread context'
    };
  }

  if (context.continuityCase === 'unknown') {
    return {
      allowed: false,
      downgradedTo: 'abstain',
      disposition: 'abstained',
      execution: 'abstain',
      reason: 'Thread is out of scope for v0 continuity'
    };
  }

  if (forbiddenTopics.some((topic) => topicMatches(latestMessage, topic))) {
    return {
      allowed: false,
      downgradedTo: 'abstain',
      disposition: 'abstained',
      execution: 'abstain',
      reason: 'Thread touches a user-forbidden topic'
    };
  }

  if (session.mode === 'dry_run') {
    return {
      allowed: true,
      disposition: 'abstained',
      execution: 'abstain',
      reason: 'Dry-run mode records the decision without side effects'
    };
  }

  if (compiledPolicy?.blockedActions.includes(action.type)) {
    return {
      allowed: false,
      downgradedTo: 'abstain',
      disposition: 'abstained',
      execution: 'abstain',
      reason: `Policy blocks ${action.type} actions`
    };
  }

  if (classifierDecision?.execution === 'abstain') {
    return {
      allowed: false,
      downgradedTo: 'abstain',
      disposition: 'abstained',
      execution: 'abstain',
      reason: classifierDecision.reason || 'Policy execution classifier chose abstain'
    };
  }

  if (compiledPolicy?.alwaysQueueTopics.some((topic) => topicMatches(latestMessage, topic))) {
    return {
      allowed: true,
      disposition: 'queued',
      execution: 'queue',
      reason: 'Policy requires operator review for this topic'
    };
  }

  if (AUTO_SEND_ACTIONS.has(action.type) && action.message.trim().length === 0) {
    return {
      allowed: false,
      downgradedTo: 'abstain',
      disposition: 'abstained',
      execution: 'abstain',
      reason: 'Auto-send action has no message body'
    };
  }

  if (action.type === 'redirect' && context.thread.participants.length < 2) {
    return {
      allowed: false,
      downgradedTo: 'ask',
      disposition: 'queued',
      execution: 'queue',
      reason: 'No obvious participant to redirect to'
    };
  }

  if (session.mode === 'manual_review') {
    return {
      allowed: true,
      disposition: 'queued',
      execution: 'queue',
      reason: compiledPolicy?.executionMode === 'auto_send_low_risk'
        ? 'Temporary manual-review session queues actions'
        : 'Policy manual-review mode queues actions by default'
    };
  }

  if (compiledPolicy && compiledPolicy.executionMode !== 'auto_send_low_risk') {
    return {
      allowed: true,
      disposition: 'queued',
      execution: 'queue',
      reason: 'Policy manual-review mode queues actions by default'
    };
  }

  if (compiledPolicy && !compiledPolicy.allowAutoSend) {
    return {
      allowed: true,
      disposition: 'queued',
      execution: 'queue',
      reason: 'User policy disables auto-send'
    };
  }

  if (hasHighRiskSkill && action.type !== 'remind') {
    return {
      allowed: true,
      disposition: 'queued',
      execution: 'queue',
      reason: 'High-risk skill context requires operator review'
    };
  }

  if (!AUTO_SEND_ACTIONS.has(action.type)) {
    return {
      allowed: true,
      disposition: 'queued',
      execution: 'queue',
      reason: 'Action requires queueing or internal scheduling'
    };
  }

  if (classifierDecision?.execution === 'queue') {
    return {
      allowed: true,
      disposition: 'queued',
      execution: 'queue',
      reason: classifierDecision.reason || 'Policy execution classifier requires operator review'
    };
  }

  return {
    allowed: true,
    disposition: 'auto_sent',
    execution: 'send',
    reason: 'Action allowed under low-risk autopilot policy'
  };
}
