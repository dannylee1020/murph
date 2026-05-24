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
  return [
    'Tools you may call. Live retrieval is all-or-nothing: either call runtime.retrieve_all once for the current request, or call no live tools. If memory.wiki.read_page is available, use it only after the memory index clearly points to one stable/follow-up page.',
    ...lines
  ].join('\n');
}

function describeGroundingDirective(directive?: GroundingDirective): string {
  if (!directive) {
    return 'If the provided context is already sufficient, answer without calling tools.';
  }
  if (directive.required) {
    return `Grounding required for factual replies: ${directive.reason} First decide whether the triggerMessage is a real Murph request. If it is unrelated, random, or out of scope, return abstain without tools. If it is relevant and needs factual/current-state evidence, call runtime.retrieve_all exactly once before drafting. If results are weak or empty, explain what is missing and defer or ask.`;
  }
  return `${directive.reason} First decide whether the triggerMessage is a real Murph request. If it is unrelated, random, or out of scope, return abstain without tools. If retrieval would materially improve a relevant answer, call runtime.retrieve_all exactly once.`;
}

function describeMemoryBoundary(): string {
  return [
    'Thread memory is conversation context, not source-of-truth evidence.',
    'Murph markdown memory is cached evidence with provenance. Use memory.tool_wiki.index to choose one indexed page, then call memory.wiki.read_page only for stable or follow-up questions.',
    'Do not rely on markdown memory for latest, current, today, now, status, changed, or source-of-truth requests; call live retrieval for those.',
    'If memory index relevance is ambiguous, page provenance is missing, or freshness metadata says to refresh, call live retrieval instead of answering from memory.',
    'The triggerMessage in the task is the current request and the primary authority.',
    'Use recentMessages only when the trigger clearly continues that same thread; do not let old thread history override an unrelated current trigger.',
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
