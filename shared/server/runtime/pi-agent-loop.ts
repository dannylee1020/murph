import { getModel, type Message, type Model, type ToolResultMessage, type UserMessage } from '@mariozechner/pi-ai';
import { runAgentLoop, type AgentContext as PiAgentContext, type AgentEvent, type AgentMessage, type AgentTool } from '@mariozechner/pi-agent-core';
import { getToolRegistry } from '#shared/server/capabilities/tool-registry';
import { DEFAULT_PROVIDER_MODEL } from '#shared/config';
import { readSecret } from '#shared/server/credentials/local-store';
import { buildGroundingPrompt } from '#shared/server/runtime/grounding-prompt';
import { RUNTIME_RETRIEVE_ALL_TOOL_NAME } from '#shared/server/runtime/tool-calling-plan';
import { toTypeBoxSchema } from '#shared/server/runtime/pi-tool-schema';
import { outputSummary, truncateToolOutput } from '#shared/server/runtime/tool-output';
import type { GroundingDirective } from '#shared/server/runtime/tool-calling-plan';
import type {
  AgentToolResult,
  ContextAssembly,
  AgentToolInventoryItem,
  ProviderDraftResult,
  ProviderName,
  RuntimeEventType,
  Workspace
} from '#shared/types';

function textContent(text: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text }];
}

function serializeForModel(output: unknown): string {
  return JSON.stringify(truncateToolOutput(output));
}

function extractToolError(message: ToolResultMessage): string {
  const text = message.content
    .filter((entry): entry is Extract<ToolResultMessage['content'][number], { type: 'text' }> => entry.type === 'text')
    .map((entry) => entry.text)
    .join('\n')
    .trim();

  if (!text) {
    return 'Tool execution failed';
  }

  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : text;
  } catch {
    return text;
  }
}

function extractAssistantText(messages: AgentMessage[]): string {
  const assistant = [...messages].reverse().find((message): message is Extract<AgentMessage, { role: 'assistant' }> => (
    typeof message === 'object' &&
    message !== null &&
    'role' in message &&
    message.role === 'assistant'
  ));

  if (!assistant) {
    throw new Error('Agent loop did not produce a final assistant message');
  }

  if (assistant.stopReason === 'error' || assistant.stopReason === 'aborted') {
    throw new Error(assistant.errorMessage ?? 'Agent loop failed');
  }

  const text = assistant.content
    .filter((entry): entry is Extract<typeof assistant.content[number], { type: 'text' }> => entry.type === 'text')
    .map((entry) => entry.text)
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('Final assistant message did not contain text');
  }

  return text;
}

function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter((message): message is Message => (
    typeof message === 'object' &&
    message !== null &&
    'role' in message &&
    (message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult')
  ));
}

function encodeToolName(rawName: string): string {
  return rawName.replace(/[^a-zA-Z0-9_-]/g, '__');
}

function buildToolAliasMaps(tools: AgentToolInventoryItem[]): {
  aliasToRaw: Map<string, string>;
  rawToAlias: Map<string, string>;
} {
  const aliasToRaw = new Map<string, string>();
  const rawToAlias = new Map<string, string>();

  for (const tool of tools) {
    const alias = encodeToolName(tool.name);
    const existing = aliasToRaw.get(alias);

    if (existing && existing !== tool.name) {
      throw new Error(`Tool alias collision: ${tool.name} and ${existing} both map to ${alias}`);
    }

    aliasToRaw.set(alias, tool.name);
    rawToAlias.set(tool.name, alias);
  }

  return { aliasToRaw, rawToAlias };
}

function rawToolName(name: string, aliasToRaw: Map<string, string>): string {
  if (aliasToRaw.has(name)) {
    return aliasToRaw.get(name) as string;
  }

  return name.includes('__') ? name.replace(/__/g, '.') : name;
}

function resolvePiApiKey(provider: string): string | undefined {
  if (provider === 'openai') {
    return process.env.OPENAI_API_KEY ?? readSecret('openai', 'api_key');
  }

  if (provider === 'anthropic') {
    return process.env.ANTHROPIC_API_KEY ?? readSecret('anthropic', 'api_key');
  }

  return undefined;
}

const OPENAI_REASONING_INCLUDE = 'reasoning.encrypted_content';

function addOpenAIReasoningContinuity(payload: unknown, model: Model<any>): unknown | undefined {
  if (model.api !== 'openai-responses' || model.reasoning !== true) {
    return undefined;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const existing = Array.isArray(record.include)
    ? record.include.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    ...record,
    // Stateless Responses tool turns need encrypted reasoning to replay reasoning items with store:false.
    include: [...new Set([...existing, OPENAI_REASONING_INCLUDE])]
  };
}

export interface GroundingLoopInput {
  context: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>;
  workspace: Workspace;
  provider: ProviderName;
  model?: string;
  maxToolCallsPerRun: number;
  groundingDirective?: GroundingDirective;
  retrievalToolNames: string[];
  defaultToolInput(name: string, input: unknown): unknown;
  enrichToolOutput(
    name: string,
    output: unknown,
    toolsUsed: string[],
    runtimeEvents: Array<{ type: RuntimeEventType; payload: unknown }>
  ): Promise<unknown>;
  retrieveAll?(
    input: unknown,
    toolsUsed: string[],
    runtimeEvents: Array<{ type: RuntimeEventType; payload: unknown }>
  ): Promise<{ output: unknown; toolResults: AgentToolResult[] }>;
  linkThreadArtifact(url: string): void;
}

export async function runGroundingLoop(input: GroundingLoopInput): Promise<{
  toolResults: AgentToolResult[];
  toolsUsed: string[];
  retrievalAttempted: boolean;
  runtimeEvents: Array<{ type: RuntimeEventType; payload: unknown }>;
  draft: ProviderDraftResult;
}> {
  const registry = getToolRegistry();
  const runtimeEvents: Array<{ type: RuntimeEventType; payload: unknown }> = [];
  const toolsUsed: string[] = [];
  const toolResults: AgentToolResult[] = [];
  let turnIndex = 0;
  let toolCallsStarted = 0;
  let retrievalAttempted = false;
  const { aliasToRaw, rawToAlias } = buildToolAliasMaps(input.context.availableTools);

  const tools: AgentTool[] = input.context.availableTools.map((tool) => ({
    name: rawToAlias.get(tool.name) ?? tool.name,
    label: tool.name,
    description: tool.description,
    parameters: toTypeBoxSchema(tool.inputSchema),
    executionMode: 'parallel',
    execute: async (toolCallId, params) => {
      if (tool.name === RUNTIME_RETRIEVE_ALL_TOOL_NAME) {
        if (!input.retrieveAll) {
          throw new Error('Runtime retrieve-all handler is not configured');
        }
        const result = await input.retrieveAll(params, toolsUsed, runtimeEvents);
        toolResults.push(...result.toolResults);
        toolsUsed.push(tool.name);
        retrievalAttempted = true;

        return {
          content: textContent(serializeForModel(result.output)),
          details: result.output
        };
      }

      const normalizedInput = input.defaultToolInput(tool.name, params);
      const output = await registry.execute(tool.name, normalizedInput, {
        workspace: input.workspace,
        task: input.context.task,
        workspaceMemory: input.context.memory.workspace
      });

      toolsUsed.push(tool.name);
      if (input.retrievalToolNames.includes(tool.name)) {
        retrievalAttempted = true;
      }

      return {
        content: textContent(serializeForModel(output)),
        details: output
      };
    }
  }));

  const prompt: UserMessage = {
    role: 'user',
    content: buildGroundingPrompt(input.context, input.groundingDirective),
    timestamp: Date.now()
  };
  const agentContext: PiAgentContext = {
    systemPrompt: '',
    messages: [],
    tools
  };

  const messages = await runAgentLoop(
    [prompt],
    agentContext,
    {
      model: getModel(input.provider as any, (input.model ?? DEFAULT_PROVIDER_MODEL[input.provider]) as any),
      convertToLlm,
      getApiKey: resolvePiApiKey,
      toolExecution: 'parallel',
      onPayload: addOpenAIReasoningContinuity,
      beforeToolCall: async ({ toolCall }) => {
        const rawName = rawToolName(toolCall.name, aliasToRaw);
        let definition;

        if (rawName === RUNTIME_RETRIEVE_ALL_TOOL_NAME) {
          definition = input.context.availableTools.find((available) => available.name === rawName);
        } else {
          try {
            definition = registry.get(rawName);
          } catch {
            return { block: true, reason: 'Tool is not registered' };
          }
        }

        if (
          !definition ||
          !input.context.availableTools.some((available) => available.name === rawName) ||
          definition.sideEffectClass !== 'read'
        ) {
          return { block: true, reason: 'Tool is not available for model-directed read-only use' };
        }

        if (toolCallsStarted >= input.maxToolCallsPerRun) {
          return { block: true, reason: 'Tool-call cap reached' };
        }

        toolCallsStarted += 1;
        return undefined;
      },
      afterToolCall: async ({ toolCall, result, isError }) => {
        if (isError) {
          return undefined;
        }

        const rawName = rawToolName(toolCall.name, aliasToRaw);

        if (rawName === RUNTIME_RETRIEVE_ALL_TOOL_NAME) {
          return undefined;
        }

        const enrichedOutput = await input.enrichToolOutput(rawName, result.details, toolsUsed, runtimeEvents);

        if (
          rawName === 'notion.read_page' &&
          enrichedOutput &&
          typeof enrichedOutput === 'object' &&
          'url' in enrichedOutput &&
          typeof enrichedOutput.url === 'string'
        ) {
          input.linkThreadArtifact(enrichedOutput.url);
          toolsUsed.push('memory.thread.link_artifact');
        }

        return {
          content: textContent(serializeForModel(enrichedOutput)),
          details: enrichedOutput
        };
      }
    },
    (event: AgentEvent) => {
      if (event.type === 'turn_start') {
        runtimeEvents.push({
          type: 'agent.model.started',
          payload: { provider: input.provider, round: turnIndex }
        });
        turnIndex += 1;
        return;
      }

      if (event.type === 'tool_execution_start') {
        const rawName = rawToolName(event.toolName, aliasToRaw);
        runtimeEvents.push({
          type: 'agent.tool.requested',
          payload: {
            id: event.toolCallId,
            name: rawName,
            reason: 'Model requested tool call',
            input: event.args
          }
        });
        return;
      }

      if (event.type === 'tool_execution_end') {
        const rawName = rawToolName(event.toolName, aliasToRaw);
        runtimeEvents.push({
          type: 'agent.tool.completed',
          payload: event.isError
            ? {
                id: event.toolCallId,
                name: rawName,
                ok: false,
                error: typeof event.result?.details === 'string' ? event.result.details : 'Tool execution failed'
              }
            : {
                id: event.toolCallId,
                name: rawName,
                ok: true,
                outputSummary: outputSummary(event.result?.details)
              }
        });
        return;
      }

      if (event.type === 'message_end' && event.message.role === 'toolResult') {
        const rawName = rawToolName(event.message.toolName, aliasToRaw);
        toolResults.push(event.message.isError
          ? {
              id: event.message.toolCallId,
              name: rawName,
              ok: false,
              error: extractToolError(event.message)
            }
          : {
              id: event.message.toolCallId,
              name: rawName,
              ok: true,
              output: truncateToolOutput(event.message.details)
            });
      }
    }
  );

  const draft = JSON.parse(extractAssistantText(messages)) as ProviderDraftResult;

  runtimeEvents.push({
    type: 'agent.model.completed',
    payload: {
      provider: input.provider,
      action: draft.proposedAction.type,
      reason: draft.proposedAction.reason,
      confidence: draft.proposedAction.confidence
    }
  });

  return {
    toolResults,
    toolsUsed,
    retrievalAttempted,
    runtimeEvents,
    draft
  };
}
