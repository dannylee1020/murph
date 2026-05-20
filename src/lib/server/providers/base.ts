import type {
  ContextAssembly,
  ModelProvider,
  PolicyExecutionDecision,
  PolicyExecutionInput,
  ProviderDraftResult
} from '#lib/types';
import { buildSkillsSystemBlock } from '#lib/server/runtime/skills-prompt';
import { MURPH_PROMPT_GUIDANCE } from '#lib/server/runtime/prompt-guidance';

function safeParseResult(content: string): ProviderDraftResult {
  const parsed = JSON.parse(content) as ProviderDraftResult;
  return parsed;
}

function safeParsePolicyExecution(content: string): PolicyExecutionDecision {
  return JSON.parse(content) as PolicyExecutionDecision;
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
    const sections: string[] = [MURPH_PROMPT_GUIDANCE];

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

  protected buildPolicyExecutionPrompt(input: PolicyExecutionInput): string {
    return [
      'You are Murph policy execution classifier. Classify what Murph should do with the proposed action after the main agent has drafted it.',
      'Do not draft or rewrite the user-facing response. Do not call tools. Return only the requested JSON shape.',
      'Executions:',
      '- send: policy allows sending the proposed action as-is.',
      '- queue: the draft is useful but needs operator review before any outbound action.',
      '- abstain: the request or proposed action is blocked, unsafe, or outside policy; do not send or queue it.',
      'Be conservative. If policy relevance is ambiguous, choose queue instead of send.',
      '',
      'Policy:',
      JSON.stringify(input.policy),
      '',
      'Session mode:',
      input.sessionMode,
      '',
      'Proposed action:',
      JSON.stringify(input.proposedAction),
      '',
      'Grounding and evidence status:',
      JSON.stringify(input.evidenceStatus ?? null),
      '',
      'Thread and memory context:',
      JSON.stringify(contextWithoutSkills(input.context))
    ].join('\n');
  }

  protected parsePolicyExecution(content: string): PolicyExecutionDecision {
    return safeParsePolicyExecution(content);
  }

  abstract classifyPolicyExecution(input: PolicyExecutionInput): Promise<PolicyExecutionDecision>;

  abstract summarizeAndPropose(
    context: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>
  ): Promise<ProviderDraftResult>;
}
