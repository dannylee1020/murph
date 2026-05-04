import type { ContextAssembly, ModelProvider, ProviderDraftResult } from '#lib/types';
import { buildSkillsSystemBlock } from '#lib/server/runtime/skills-prompt';

const MURPH_IDENTITY = [
  'You are Murph, a bounded channel continuity agent that watches a teammate\'s threads while they are offline.',
  'Return strict JSON with keys: continuityCase, summary, unresolvedQuestions, proposedAction.',
  'proposedAction must contain: type, message, reason, confidence.',
  'Only use actions: reply, ask, redirect, defer, remind, abstain.',
  'Be conservative and avoid speculative claims.'
].join('\n');

function safeParseResult(content: string): ProviderDraftResult {
  const parsed = JSON.parse(content) as ProviderDraftResult;
  return parsed;
}

function contextWithoutSkills(
  context: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>
): Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase' | 'skills'> {
  const { skills: _skills, ...rest } = context;
  return rest;
}

export abstract class JsonPromptProvider implements ModelProvider {
  abstract readonly name: 'openai' | 'anthropic';

  protected buildPrompt(
    context: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>
  ): string {
    const skillsBlock = buildSkillsSystemBlock(context.skills);
    const sections: string[] = [MURPH_IDENTITY];

    if (skillsBlock) {
      sections.push(skillsBlock);
    }

    sections.push('Thread, memory, and artifact context:');
    sections.push(JSON.stringify(contextWithoutSkills(context)));

    return sections.join('\n\n');
  }

  protected parse(content: string): ProviderDraftResult {
    return safeParseResult(content);
  }

  abstract summarizeAndPropose(
    context: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>
  ): Promise<ProviderDraftResult>;
}
