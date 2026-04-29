import type { ContextAssembly, ModelProvider, ProviderDraftResult } from '#lib/types';

function safeParseResult(content: string): ProviderDraftResult {
  const parsed = JSON.parse(content) as ProviderDraftResult;
  return parsed;
}

export abstract class JsonPromptProvider implements ModelProvider {
  abstract readonly name: 'openai' | 'anthropic';

  protected buildPrompt(
    context: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>
  ): string {
    return [
      'You are Murph, a bounded channel continuity agent.',
      'Return strict JSON with keys: continuityCase, summary, unresolvedQuestions, proposedAction.',
      'proposedAction must contain: type, message, reason, confidence.',
      'Only use actions: reply, ask, redirect, defer, remind, abstain.',
      'Be conservative and avoid speculative claims.',
      '',
      JSON.stringify(context)
    ].join('\n');
  }

  protected parse(content: string): ProviderDraftResult {
    return safeParseResult(content);
  }

  abstract summarizeAndPropose(
    context: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>
  ): Promise<ProviderDraftResult>;
}
