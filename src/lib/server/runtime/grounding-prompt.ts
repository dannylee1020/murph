import type { ContextAssembly } from '#lib/types';
import type { RuntimeRetrievalPlan } from '#lib/server/runtime/tool-calling-plan';

export function buildGroundingPrompt(
  context: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>,
  retrievalPlan?: RuntimeRetrievalPlan
): string {
  const availableTools = context.availableTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    knowledgeDomains: tool.knowledgeDomains ?? []
  }));

  return [
    'You are Murph, a bounded channel continuity agent.',
    'Return strict JSON with keys: continuityCase, summary, unresolvedQuestions, proposedAction.',
    'proposedAction must contain: type, message, reason, confidence.',
    'Only use actions: reply, ask, redirect, defer, remind, abstain.',
    'Use available tools only when they are needed for factual grounding.',
    'The provided context already includes thread history, user preferences, workspace memory, and thread memory.',
    retrievalPlan?.required
      ? `Grounding is required for this request. ${retrievalPlan.reason} You MUST call a relevant retrieval/search tool before drafting. If the search results are weak or empty, explain what you searched and say you are queueing this for review.`
      : 'If the provided context is already sufficient, answer without calling tools.',
    'Choose the best matching search tool yourself based on the tool descriptions and knowledge domains.',
    'Be conservative and avoid speculative claims.',
    '',
    JSON.stringify({
      context,
      availableTools
    })
  ].join('\n');
}
