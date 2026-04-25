import OpenAI from 'openai';
import { DEFAULT_PROVIDER_MODEL } from '#lib/config';
import { getRuntimeEnv } from '#lib/server/util/env';
import { JsonPromptProvider } from '#lib/server/providers/base';
import type { ContextAssembly, ProviderDraftResult } from '#lib/types';

const DRAFT_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'submit_draft',
    strict: true,
    schema: {
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
    }
  }
} as const;

export class OpenAIProvider extends JsonPromptProvider {
  readonly name = 'openai' as const;
  private readonly client: OpenAI;

  constructor(private readonly model = DEFAULT_PROVIDER_MODEL.openai) {
    super();
    const env = getRuntimeEnv();

    if (!env.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAI provider');
    }

    this.client = new OpenAI({ apiKey: env.openaiApiKey });
  }

  async summarizeAndPropose(
    context: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>
  ): Promise<ProviderDraftResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: this.buildPrompt(context) }],
      response_format: DRAFT_RESPONSE_FORMAT as any
    } as any);
    const text = response.choices[0]?.message?.content ?? '';

    return this.parse(text);
  }
}
