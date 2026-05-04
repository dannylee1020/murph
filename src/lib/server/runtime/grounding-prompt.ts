import type { ContextAssembly } from '#lib/types';
import { buildSkillsSystemBlock } from '#lib/server/runtime/skills-prompt';
import type { GroundingDirective } from '#lib/server/runtime/tool-calling-plan';

const MURPH_IDENTITY = [
  'You are Murph, a bounded channel continuity agent that watches a teammate\'s threads while they are offline.',
  'Return strict JSON with keys: continuityCase, summary, unresolvedQuestions, proposedAction.',
  'proposedAction must contain: type, message, reason, confidence.',
  'Only use actions: reply, ask, redirect, defer, remind, abstain.',
  'Be conservative and avoid speculative claims.'
].join('\n');

function describeAvailableTools(context: Pick<ContextAssembly, 'availableTools'>): string {
  if (context.availableTools.length === 0) {
    return 'No tools are available for this run; answer from the provided context only.';
  }

  const lines = context.availableTools.map((tool) => {
    const domains = tool.knowledgeDomains?.length ? ` (${tool.knowledgeDomains.join(', ')})` : '';
    return `- ${tool.name}${domains}: ${tool.description}`;
  });
  return ['Tools you may call (pick the right one based on its description and domains):', ...lines].join('\n');
}

function describeGroundingDirective(directive?: GroundingDirective): string {
  if (!directive) {
    return 'If the provided context is already sufficient, answer without calling tools.';
  }
  if (directive.required) {
    return `Grounding required: ${directive.reason} You MUST call a relevant retrieval/search tool before drafting. If results are weak or empty, explain what you searched and queue the thread for review.`;
  }
  return `${directive.reason} Call a retrieval tool only when it materially improves the answer.`;
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
  const sections: string[] = [MURPH_IDENTITY];

  if (skillsBlock) {
    sections.push(skillsBlock);
  }

  sections.push(describeAvailableTools(context));
  sections.push(describeGroundingDirective(directive));
  sections.push('');
  sections.push('Thread, memory, and artifact context:');
  sections.push(JSON.stringify(contextWithoutSkills(context)));

  return sections.join('\n\n');
}
