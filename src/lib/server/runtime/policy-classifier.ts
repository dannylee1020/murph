import { getPolicyModelProvider } from '#lib/server/providers/index';
import { resolvePolicyForRequest } from '#lib/server/runtime/policy';
import type {
    AutopilotSession,
    ContextAssembly,
    PolicyExecutionDecision,
    ProposedAction,
    ThreadEvidenceStatus,
} from '#lib/types';

const MIN_CLASSIFIER_CONFIDENCE = 0.75;

function normalizeExecutionDecision(
    input: PolicyExecutionDecision,
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

    if (confidence < MIN_CLASSIFIER_CONFIDENCE && execution === 'send') {
        return {
            execution: 'queue',
            matchedTopics: Array.isArray(input.matchedTopics)
                ? input.matchedTopics
                : [],
            matchedRuleIds: Array.isArray(input.matchedRuleIds)
                ? input.matchedRuleIds
                : [],
            reason:
                input.reason ||
                'Policy execution classifier confidence was too low to send',
            confidence,
        };
    }

    return {
        execution,
        matchedTopics: Array.isArray(input.matchedTopics)
            ? input.matchedTopics
            : [],
        matchedRuleIds: Array.isArray(input.matchedRuleIds)
            ? input.matchedRuleIds
            : [],
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
