import type { ContextAssembly } from '#lib/types';
import { buildSkillsSystemBlock } from '#lib/server/runtime/skills-prompt';
import type { GroundingDirective } from '#lib/server/runtime/tool-calling-plan';
import { MURPH_PROMPT_GUIDANCE } from '#lib/server/runtime/prompt-guidance';

function describeAvailableTools(context: Pick<ContextAssembly, 'availableTools'>): string {
  if (context.availableTools.length === 0) {
    return 'No tools are available for this run; answer from the provided context only.';
  }

  const lines = context.availableTools.map((tool) => {
    const domains = tool.knowledgeDomains?.length ? ` (${tool.knowledgeDomains.join(', ')})` : '';
    return `- ${tool.name}${domains}: ${tool.description}`;
  });
  return ['Tools you may call. Call the retrieval tools that are relevant to the request; avoid unrelated sources even when they are available:', ...lines].join('\n');
}

function describeGroundingDirective(directive?: GroundingDirective): string {
  if (!directive) {
    return 'If the provided context is already sufficient, answer without calling tools.';
  }
  if (directive.required) {
    return `Grounding required: ${directive.reason} You MUST call the relevant retrieval/search tools before drafting. Use every source that is materially relevant to this request, but do not call unrelated tools. If results are weak or empty, explain what you searched and queue the thread for review.`;
  }
  return `${directive.reason} Call a retrieval tool only when it materially improves the answer.`;
}

function describeMemoryBoundary(): string {
  return [
    'Thread memory is conversation context, not source-of-truth evidence.',
    'Current-run artifacts may include broad fanout results from connected read-only sources; compare all relevant artifacts before drafting.',
    'If sources conflict, say which source says what instead of guessing.',
    'Use it to understand what the thread has been discussing, but do not answer factual or current-state questions from thread memory alone.',
    'For factual or current claims, rely on current-run source artifacts, successful current-run tool results, or explicit source documents retrieved in this run.'
  ].join(' ');
}

function contextWithoutSkills(
  context: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>
): Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase' | 'skills' | 'availableTools'> {
  const { skills: _skills, availableTools: _availableTools, ...rest } = context;
  return rest;
}

export function buildGroundingPrompt(
  context: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>,
  directive?: GroundingDirective
): string {
  const skillsBlock = buildSkillsSystemBlock(context.skills);
  const sections: string[] = [MURPH_PROMPT_GUIDANCE];

  if (skillsBlock) {
    sections.push(skillsBlock);
  }

  sections.push(describeAvailableTools(context));
  sections.push(describeGroundingDirective(directive));
  sections.push(describeMemoryBoundary());
  sections.push('');
  sections.push('Thread, memory, and artifact context:');
  sections.push(JSON.stringify(contextWithoutSkills(context)));

  return sections.join('\n\n');
}
