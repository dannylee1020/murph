import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getToolRegistry } from '#app/server/capabilities/tool-registry';
import { getStore } from '#app/server/persistence/store';
import { getRuntimeEnv } from '#app/server/util/env';
import {
  SOURCE_INDEX_MAX_PREVIEW_CHARS,
  SOURCE_INDEX_MAX_SUMMARY_CHARS,
  readSourceIndexResource,
  writeSourceIndexResource,
  type SourceIndexResource
} from './catalog.js';

const MAX_SUMMARIES_PER_REFRESH = 3;
const MAX_MODEL_INPUT_CHARS = 6000;

export interface SourceIndexSummaryResult {
  generated: number;
  skipped: number;
  failed: number;
}

function compact(value: string | undefined, limit: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function modelSummariesEnabled(): boolean {
  if (process.env.NODE_ENV === 'test' && process.env.MURPH_SOURCE_INDEX_SUMMARIES_IN_TEST !== 'true') {
    return false;
  }
  const env = getRuntimeEnv();
  return env.agentProvider === 'anthropic'
    ? Boolean(env.anthropicApiKey)
    : Boolean(env.openaiApiKey);
}

function shouldSummarize(resource: SourceIndexResource): boolean {
  if (resource.metadata.status !== 'active') {
    return false;
  }
  if (!resource.metadata.readTool && !resource.contentPreview) {
    return false;
  }
  if (!resource.contentSummary) {
    return true;
  }
  const sourceUpdatedAt = resource.metadata.sourceUpdatedAt ? new Date(resource.metadata.sourceUpdatedAt).getTime() : undefined;
  const summaryUpdatedAt = resource.metadata.summaryUpdatedAt ? new Date(resource.metadata.summaryUpdatedAt).getTime() : undefined;
  return Boolean(
    sourceUpdatedAt &&
    summaryUpdatedAt &&
    Number.isFinite(sourceUpdatedAt) &&
    Number.isFinite(summaryUpdatedAt) &&
    sourceUpdatedAt > summaryUpdatedAt
  );
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function outputToText(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return '';
  }
  const record = output as Record<string, unknown>;
  const fields = [
    stringField(record, 'text'),
    stringField(record, 'body'),
    stringField(record, 'description'),
    stringField(record, 'summary'),
    stringField(record, 'transcriptText'),
    stringField(record, 'title')
  ].filter(Boolean);
  return fields.length > 0 ? fields.join('\n\n') : JSON.stringify(output);
}

async function sourceText(resource: SourceIndexResource, workspaceId: string): Promise<string> {
  if (resource.contentPreview) {
    return compact(resource.contentPreview, MAX_MODEL_INPUT_CHARS);
  }
  if (!resource.metadata.readTool || !resource.metadata.readInput) {
    return '';
  }
  const store = getStore();
  const workspace = store.getWorkspaceById(workspaceId);
  if (!workspace) {
    return '';
  }
  const output = await getToolRegistry().execute(resource.metadata.readTool, resource.metadata.readInput, {
    workspace,
    workspaceMemory: store.getOrCreateWorkspaceMemory(workspaceId)
  });
  return compact(outputToText(output), MAX_MODEL_INPUT_CHARS);
}

function summaryPrompt(resource: SourceIndexResource, text: string): string {
  return [
    'Summarize this connected-source resource for routing only.',
    'Do not treat the summary as source-of-truth evidence.',
    'Return 1-3 concise sentences naming the topic, important entities, and when a user would want this source.',
    '',
    'Resource metadata:',
    JSON.stringify({
      provider: resource.metadata.provider,
      resourceType: resource.metadata.resourceType,
      title: resource.metadata.title,
      externalId: resource.metadata.externalId,
      tags: resource.metadata.tags
    }),
    '',
    'Resource text:',
    text
  ].join('\n');
}

async function summarizeWithModel(resource: SourceIndexResource, text: string): Promise<string> {
  const env = getRuntimeEnv();
  const prompt = summaryPrompt(resource, text);
  if (env.agentProvider === 'anthropic') {
    if (!env.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: env.agentModel,
      max_tokens: 180,
      messages: [{ role: 'user', content: prompt }]
    });
    const textBlocks = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''));
    return compact(textBlocks.join('\n'), SOURCE_INDEX_MAX_SUMMARY_CHARS);
  }
  if (!env.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  const client = new OpenAI({ apiKey: env.openaiApiKey });
  const response = await client.chat.completions.create({
    model: env.agentModel,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 180
  });
  return compact(response.choices[0]?.message?.content ?? '', SOURCE_INDEX_MAX_SUMMARY_CHARS);
}

export async function summarizeChangedSourceIndexResources(input: {
  workspaceId: string;
  changedPaths: string[];
  limit?: number;
}): Promise<SourceIndexSummaryResult> {
  const result: SourceIndexSummaryResult = { generated: 0, skipped: 0, failed: 0 };
  if (!modelSummariesEnabled()) {
    return { ...result, skipped: input.changedPaths.length };
  }
  const uniquePaths = [...new Set(input.changedPaths)];
  const limit = Math.max(0, Math.min(input.limit ?? MAX_SUMMARIES_PER_REFRESH, MAX_SUMMARIES_PER_REFRESH));

  for (const relativePath of uniquePaths) {
    if (result.generated >= limit) {
      result.skipped += 1;
      continue;
    }
    const resource = await readSourceIndexResource(relativePath);
    if (!resource || !shouldSummarize(resource)) {
      result.skipped += 1;
      continue;
    }

    try {
      const text = await sourceText(resource, input.workspaceId);
      if (!text) {
        await writeSourceIndexResource({
          ...resource,
          metadata: {
            ...resource.metadata,
            summaryStatus: 'skipped',
            summaryUpdatedAt: new Date().toISOString()
          }
        });
        result.skipped += 1;
        continue;
      }
      const summary = await summarizeWithModel(resource, text);
      await writeSourceIndexResource({
        ...resource,
        metadata: {
          ...resource.metadata,
          summaryStatus: summary ? 'generated' : 'skipped',
          summaryUpdatedAt: new Date().toISOString()
        },
        contentSummary: summary || undefined,
        contentPreview: resource.contentPreview ?? compact(text, SOURCE_INDEX_MAX_PREVIEW_CHARS)
      });
      if (summary) {
        result.generated += 1;
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      console.warn('[source-index] summary generation failed:', error instanceof Error ? error.message : error);
      await writeSourceIndexResource({
        ...resource,
        metadata: {
          ...resource.metadata,
          summaryStatus: 'failed',
          summaryUpdatedAt: new Date().toISOString()
        }
      });
      result.failed += 1;
    }
  }

  return result;
}
