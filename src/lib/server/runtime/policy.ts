import { DEFAULT_AUTO_SEND_ACTIONS } from '#lib/config';
import type {
  AutopilotSession,
  ContextAssembly,
  ContinuityActionType,
  PolicyDecision,
  ProposedAction
} from '#lib/types';

const AUTO_SEND_ACTIONS = new Set<ContinuityActionType>(DEFAULT_AUTO_SEND_ACTIONS);

export function evaluatePolicy(
  action: ProposedAction,
  context: ContextAssembly,
  session: AutopilotSession
): PolicyDecision {
  const latestMessage = context.thread.latestMessage.trim().toLowerCase();
  const compiledPolicy = session.policy?.compiled ?? context.memory.user?.policy?.compiled;
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
