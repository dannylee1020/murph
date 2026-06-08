import type { ContextAssembly } from '#app/types';
import { buildSkillsSystemBlock } from '#app/server/runtime/skills-prompt';
import type { GroundingDirective } from '#app/server/runtime/tool-calling-plan';
import { MURPH_PROMPT_GUIDANCE } from '#app/server/runtime/prompt-guidance';

function describeAvailableTools(context: Pick<ContextAssembly, 'availableTools'>): string {
  if (context.availableTools.length === 0) {
    return 'No tools are available for this run; answer from the provided context only.';
  }

  const lines = context.availableTools.map((tool) => {
    const domains = tool.knowledgeDomains?.length ? ` (${tool.knowledgeDomains.join(', ')})` : '';
    if (tool.hintedRead) {
      return `- ${tool.name}${domains}: ${tool.description} Choose the matching hintId; the runtime executes the stored live read input.`;
    }
    return `- ${tool.name}${domains}: ${tool.description}`;
  });
  const hasHintedTools = context.availableTools.some((tool) => tool.hintedRead);
  const heading = hasHintedTools
    ? 'Tools you may call. Source-index hints are available for this request; choose the most relevant hinted read tool before drafting factual replies.'
    : 'Tools you may call. No usable source-index hint is available, so live retrieval is all-or-nothing: either call runtime.retrieve_all once for the current request, or call no live tools.';
  return [
    heading,
    ...lines
  ].join('\n');
}

function describeGroundingDirective(directive?: GroundingDirective): string {
  if (!directive) {
    return 'If the provided context is already sufficient, answer without calling tools.';
  }
  if (directive.required) {
    return `Grounding required for factual replies: ${directive.reason} First decide whether the triggerMessage is a real Murph request. If it is unrelated, random, or out of scope, return abstain without tools. If hinted read tools are listed and a hint matches the request, call the best hinted read tool before drafting. If no hinted read tools are listed and factual/current-state evidence is needed, call runtime.retrieve_all exactly once before drafting. If results are weak or empty, explain what is missing and defer or ask.`;
  }
  return `${directive.reason} First decide whether the triggerMessage is a real Murph request. If it is unrelated, random, or out of scope, return abstain without tools. If hinted read tools are listed and a hint matches the request, call the best hinted read tool. If no hinted read tools are listed and retrieval would materially improve a relevant answer, call runtime.retrieve_all exactly once.`;
}

function describeMemoryBoundary(): string {
  return [
    'Thread memory is conversation context, not source-of-truth evidence.',
    'Do not rely on stored memory for latest, current, today, now, status, changed, or source-of-truth requests; call live retrieval for those.',
    'The triggerMessage in the task is the current request and the primary authority.',
    'Use recentMessages only when the trigger clearly continues that same thread; do not let old thread history override an unrelated current trigger.',
    'Current-run artifacts may include broad fanout results from connected read-only sources; compare all relevant artifacts before drafting.',
    'Source index hints are routing hints only; they are not source-of-truth evidence.',
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
