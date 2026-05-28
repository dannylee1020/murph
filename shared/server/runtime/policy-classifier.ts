import { getPolicyModelProvider } from '#shared/server/providers/index';
import { resolvePolicyForRequest } from '#shared/server/runtime/policy';
import type {
    AutopilotSession,
    ContextAssembly,
    PolicyExecutionDecision,
    ProposedAction,
    ThreadEvidenceStatus,
} from '#shared/types';

const MIN_CLASSIFIER_CONFIDENCE = 0.75;

function normalizeExecutionDecision(
    input: PolicyExecutionDecision,
    proposedAction: ProposedAction,
    evidenceStatus?: ThreadEvidenceStatus,
): PolicyExecutionDecision {
    const execution =
        input.execution === 'send' ||
        input.execution === 'queue' ||
        input.execution === 'abstain'
            ? input.execution
            : 'queue';
    const confidence = Number.isFinite(input.confidence)
        ? Math.max(0, Math.min(1, input.confidence))
        : 0;

    const matchedTopics = Array.isArray(input.matchedTopics)
        ? input.matchedTopics
        : [];
    const matchedRuleIds = Array.isArray(input.matchedRuleIds)
        ? input.matchedRuleIds
        : [];
    const hasSuccessfulEvidence = (evidenceStatus?.successfulTools.length ?? 0) > 0;
    const abstainOnlyForPartialEvidence =
        execution === 'abstain' &&
        evidenceStatus?.status === 'partial' &&
        hasSuccessfulEvidence &&
        matchedTopics.length === 0 &&
        matchedRuleIds.length === 0 &&
        proposedAction.type !== 'abstain' &&
        proposedAction.message.trim().length > 0 &&
        proposedAction.confidence >= 0.7;

    if (abstainOnlyForPartialEvidence) {
        return {
            execution: 'queue',
            matchedTopics,
            matchedRuleIds,
            reason:
                input.reason ||
                'Partial evidence includes successful grounding, so failed read-only tools require review instead of abstain',
            confidence,
        };
    }

    if (confidence < MIN_CLASSIFIER_CONFIDENCE && execution === 'send') {
        return {
            execution: 'queue',
            matchedTopics,
            matchedRuleIds,
            reason:
                input.reason ||
                'Policy execution classifier confidence was too low to send',
            confidence,
        };
    }

    return {
        execution,
        matchedTopics,
        matchedRuleIds,
        reason: input.reason || 'Policy execution classifier returned a decision',
        confidence,
    };
}

export async function classifyPolicyExecution(
    context: ContextAssembly,
    session: AutopilotSession,
    proposedAction: ProposedAction,
    evidenceStatus?: ThreadEvidenceStatus,
): Promise<PolicyExecutionDecision> {
    try {
        const provider = getPolicyModelProvider();
        return normalizeExecutionDecision(
            await provider.classifyPolicyExecution({
                context,
                proposedAction,
                policy: resolvePolicyForRequest(context, session),
                sessionMode: session.mode,
                evidenceStatus,
            }),
            proposedAction,
            evidenceStatus,
        );
    } catch (error) {
        return {
            execution: 'queue',
            matchedTopics: [],
            matchedRuleIds: [],
            reason:
                error instanceof Error
                    ? `Policy execution classifier failed: ${error.message}`
                    : 'Policy execution classifier failed',
            confidence: 0,
        };
    }
}
