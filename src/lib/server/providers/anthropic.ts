import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_PROVIDER_MODEL } from '#lib/config';
import { getRuntimeEnv } from '#lib/server/util/env';
import { JsonPromptProvider } from '#lib/server/providers/base';
import type { ContextAssembly, PolicyExecutionDecision, PolicyExecutionInput, ProviderDraftResult } from '#lib/types';

const DRAFT_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['continuityCase', 'summary', 'unresolvedQuestions', 'proposedAction'],
  properties: {
    continuityCase: {
      type: 'string',
      enum: ['status_request', 'clarification', 'blocker', 'handoff', 'availability', 'unknown']
    },
    summary: { type: 'string' },
    unresolvedQuestions: { type: 'array', items: { type: 'string' } },
    proposedAction: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'message', 'reason', 'confidence'],
      properties: {
        type: { type: 'string', enum: ['reply', 'ask', 'redirect', 'defer', 'remind', 'abstain'] },
        message: { type: 'string' },
        reason: { type: 'string' },
        confidence: { type: 'number' }
      }
    }
  }
};

const SUBMIT_DRAFT_TOOL = {
  name: 'submit_draft',
  description: 'Submit the final Murph continuity draft.',
  input_schema: DRAFT_INPUT_SCHEMA
};

const POLICY_EXECUTION_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['execution', 'matchedTopics', 'matchedRuleIds', 'reason', 'confidence'],
  properties: {
    execution: { type: 'string', enum: ['send', 'queue', 'abstain'] },
    matchedTopics: { type: 'array', items: { type: 'string' } },
    matchedRuleIds: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
    confidence: { type: 'number' }
  }
};

const CLASSIFY_POLICY_EXECUTION_TOOL = {
  name: 'classify_policy_execution',
  description: 'Classify whether Murph should send, queue, or abstain from the proposed action under the selected policy.',
  input_schema: POLICY_EXECUTION_INPUT_SCHEMA
};

export class AnthropicProvider extends JsonPromptProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(private readonly model = DEFAULT_PROVIDER_MODEL.anthropic) {
    super();
    const env = getRuntimeEnv();

    if (!env.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for Anthropic provider');
    }

    this.client = new Anthropic({ apiKey: env.anthropicApiKey });
  }

  async classifyPolicyExecution(input: PolicyExecutionInput): Promise<PolicyExecutionDecision> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 400,
      messages: [{ role: 'user', content: this.buildPolicyExecutionPrompt(input) }],
      tools: [CLASSIFY_POLICY_EXECUTION_TOOL] as any,
      tool_choice: { type: 'tool', name: 'classify_policy_execution' }
    } as any);
    const result = response.content.find(
      (block): block is any => block.type === 'tool_use' && block.name === 'classify_policy_execution'
    );

    if (result) {
      return result.input as PolicyExecutionDecision;
    }

    return this.parsePolicyExecution(
      response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n')
    );
  }

  async summarizeAndPropose(
    context: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>
  ): Promise<ProviderDraftResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 600,
      messages: [{ role: 'user', content: this.buildPrompt(context) }],
      tools: [SUBMIT_DRAFT_TOOL] as any,
      tool_choice: { type: 'tool', name: 'submit_draft' }
    } as any);
    const draft = response.content.find((block): block is any => block.type === 'tool_use' && block.name === 'submit_draft');

    if (draft) {
      return draft.input as ProviderDraftResult;
    }

    return this.parse(
      response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n')
    );
  }
}
