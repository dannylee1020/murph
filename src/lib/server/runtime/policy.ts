import { DEFAULT_AUTO_SEND_ACTIONS } from '#lib/config';
import type {
  AutopilotSession,
  CompiledPolicy,
  ContextAssembly,
  ContinuityActionType,
  PolicyControls,
  PolicyDecision,
  ProposedAction
} from '#lib/types';
import { builtinPolicyProfile } from '#lib/server/runtime/policy-compiler';

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
  return {
    blockedTopics: unique([...base.blockedTopics, ...(controls.blockedTopics ?? [])]),
    alwaysQueueTopics: unique([...base.alwaysQueueTopics, ...(controls.alwaysQueueTopics ?? [])]),
    blockedActions: [...new Set([...base.blockedActions, ...(controls.blockedActions ?? [])])],
    requireGroundingForFacts: controls.requireGroundingForFacts ?? base.requireGroundingForFacts,
    preferAskWhenUncertain: controls.preferAskWhenUncertain ?? base.preferAskWhenUncertain,
    allowAutoSend: controls.allowAutoSend ?? base.allowAutoSend,
    notesForAgent: unique([...base.notesForAgent, ...(controls.notesForAgent ?? [])]),
    rules: base.rules
  };
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

export function evaluatePolicy(
  action: ProposedAction,
  context: ContextAssembly,
  session: AutopilotSession
): PolicyDecision {
  const latestMessage = context.thread.latestMessage.trim().toLowerCase();
  const compiledPolicy = resolveRuntimePolicy(
    session.policy?.compiled ?? builtinPolicyProfile(session.mode).compiled,
    action,
    context
  );
  const forbiddenTopics = Array.from(
    new Set([...(context.memory.user?.forbiddenTopics ?? []), ...(compiledPolicy?.blockedTopics ?? [])])
  );
  const hasHighRiskSkill = context.skills.some((skill) => skill.riskLevel === 'high');
  const hasGroundingArtifacts = context.artifacts.length > 0 || context.linkedArtifacts.length > 0;
  const queueDisposition = action.type === 'remind' ? 'scheduled' : 'queued';

  if (context.thread.latestMessage.trim().length === 0) {
    return {
      allowed: false,
      downgradedTo: 'abstain',
      disposition: 'abstained',
      reason: 'Empty thread context'
    };
  }

  if (context.continuityCase === 'unknown') {
    return {
      allowed: false,
      downgradedTo: 'abstain',
      disposition: 'abstained',
      reason: 'Thread is out of scope for v0 continuity'
    };
  }

  if (forbiddenTopics.some((topic) => latestMessage.includes(topic.toLowerCase()))) {
    return {
      allowed: false,
      downgradedTo: 'abstain',
      disposition: 'abstained',
      reason: 'Thread touches a user-forbidden topic'
    };
  }

  if (session.mode === 'dry_run') {
    return {
      allowed: true,
      disposition: 'abstained',
      reason: 'Dry-run mode records the decision without side effects'
    };
  }

  if (compiledPolicy?.blockedActions.includes(action.type)) {
    return {
      allowed: false,
      downgradedTo: 'abstain',
      disposition: 'abstained',
      reason: `Policy blocks ${action.type} actions`
    };
  }

  if (compiledPolicy?.alwaysQueueTopics.some((topic) => latestMessage.includes(topic.toLowerCase()))) {
    return {
      allowed: true,
      disposition: queueDisposition,
      reason: 'Policy requires operator review for this topic'
    };
  }

  if (compiledPolicy?.requireGroundingForFacts && action.type === 'reply' && !hasGroundingArtifacts) {
    return {
      allowed: false,
      downgradedTo: 'ask',
      disposition: 'queued',
      reason: 'Policy requires grounded facts before sending a factual reply'
    };
  }

  if (compiledPolicy?.preferAskWhenUncertain && action.confidence < 0.75) {
    return {
      allowed: false,
      downgradedTo: 'ask',
      disposition: 'queued',
      reason: 'Policy prefers a clarification when confidence is borderline'
    };
  }

  if (action.confidence < 0.55) {
    return {
      allowed: false,
      downgradedTo: 'abstain',
      disposition: 'abstained',
      reason: 'Model confidence below v0 threshold'
    };
  }

  if (AUTO_SEND_ACTIONS.has(action.type) && action.message.trim().length === 0) {
    return {
      allowed: false,
      downgradedTo: 'abstain',
      disposition: 'abstained',
      reason: 'Auto-send action has no message body'
    };
  }

  if (action.type === 'redirect' && context.thread.participants.length < 2) {
    return {
      allowed: false,
      downgradedTo: 'ask',
      disposition: 'queued',
      reason: 'No obvious participant to redirect to'
    };
  }

  if (session.mode === 'manual_review') {
    return {
      allowed: true,
      disposition: queueDisposition,
      reason: 'Manual review session queues actions by default'
    };
  }

  if (compiledPolicy && !compiledPolicy.allowAutoSend) {
    return {
      allowed: true,
      disposition: queueDisposition,
      reason: 'User policy disables auto-send'
    };
  }

  if (hasHighRiskSkill && action.type !== 'remind') {
    return {
      allowed: true,
      disposition: 'queued',
      reason: 'High-risk skill context requires operator review'
    };
  }

  if (!AUTO_SEND_ACTIONS.has(action.type)) {
    return {
      allowed: true,
      disposition: queueDisposition,
      reason: 'Action requires queueing or internal scheduling'
    };
  }

  return {
    allowed: true,
    disposition: 'auto_sent',
    reason: 'Action allowed under low-risk autopilot policy'
  };
}
