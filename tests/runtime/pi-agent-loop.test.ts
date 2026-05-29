import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderDraftResult } from '../../shared/types';

const runAgentLoopMock = vi.fn();
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
const originalCredentialsPath = process.env.MURPH_CREDENTIALS_PATH;

vi.mock('@mariozechner/pi-agent-core', async () => {
  const actual = await vi.importActual<typeof import('@mariozechner/pi-agent-core')>('@mariozechner/pi-agent-core');

  return {
    ...actual,
    runAgentLoop: (...args: unknown[]) => runAgentLoopMock(...args)
  };
});

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0
  }
};

const draft: ProviderDraftResult = {
  continuityCase: 'clarification',
  summary: 'summary',
  unresolvedQuestions: [],
  proposedAction: {
    type: 'reply',
    message: 'reply',
    reason: 'grounded',
    confidence: 0.8
  }
};

function finalAssistantMessage() {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: JSON.stringify(draft) }],
    api: 'openai',
    provider: 'openai',
    model: 'gpt-5.4-mini',
    usage,
    stopReason: 'stop' as const,
    timestamp: Date.now()
  };
}

function alias(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '__');
}

function baseContext() {
  return {
    workspaceId: 'workspace',
    task: {
      id: 'task',
      source: 'slack_event' as const,
      workspaceId: 'workspace',
      thread: { provider: 'slack', channelId: 'channel', threadTs: '1.0' },
      targetUserId: 'owner',
      receivedAt: new Date().toISOString()
    },
    targetUserId: 'owner',
    thread: {
      ref: { provider: 'slack', channelId: 'channel', threadTs: '1.0' },
      latestMessage: 'status?',
      recentMessages: [],
      participants: []
    },
    memory: {
      user: { userId: 'owner', preferences: [], forbiddenTopics: [], routingHints: [] },
      workspace: {
        workspaceId: 'workspace',
        channelMappings: [],
        escalationRules: [],
        enabledOptionalTools: [],
        enabledContextSources: [],
        enabledPlugins: []
      },
      thread: {
        workspaceId: 'workspace',
        channelId: 'channel',
        threadTs: '1.0',
        linkedArtifacts: [],
        openQuestions: [],
        blockerNotes: []
      }
    },
    skills: [],
    availableTools: [],
    linkedArtifacts: [],
    artifacts: []
  };
}

describe('runGroundingLoop', () => {
  beforeEach(() => {
    vi.resetModules();
    runAgentLoopMock.mockReset();
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MURPH_CREDENTIALS_PATH;
  });

  afterEach(() => {
    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    }

    if (originalAnthropicApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
    }

    if (originalCredentialsPath === undefined) {
      delete process.env.MURPH_CREDENTIALS_PATH;
    } else {
      process.env.MURPH_CREDENTIALS_PATH = originalCredentialsPath;
    }
  });

  it('passes OpenAI credentials from the local credential store to the Pi agent loop', async () => {
    process.env.MURPH_CREDENTIALS_PATH = join(mkdtempSync(join(tmpdir(), 'murph-pi-loop-credentials-')), '.credentials');

    const { writeSecret } = await import('#shared/server/credentials/local-store');
    writeSecret('openai', 'api_key', 'sk-from-credentials');

    const { runGroundingLoop } = await import('#shared/server/runtime/pi-agent-loop');
    runAgentLoopMock.mockImplementation(async (_prompts, _agentContext, config) => {
      expect(await config.getApiKey?.('openai')).toBe('sk-from-credentials');
      return [finalAssistantMessage()];
    });

    await runGroundingLoop({
      context: baseContext(),
      workspace: { id: 'workspace', provider: 'slack' as const, externalWorkspaceId: 'workspace', name: 'Workspace' },
      provider: 'openai',
      maxToolCallsPerRun: 6,
      retrievalToolNames: [],
      defaultToolInput: (_, toolInput) => toolInput,
      enrichToolOutput: async (_, output) => output,
      linkThreadArtifact: () => undefined
    });
  });

  it('keeps OpenAI environment variables ahead of local credentials', async () => {
    process.env.MURPH_CREDENTIALS_PATH = join(mkdtempSync(join(tmpdir(), 'murph-pi-loop-credentials-')), '.credentials');
    process.env.OPENAI_API_KEY = 'sk-from-env';

    const { writeSecret } = await import('#shared/server/credentials/local-store');
    writeSecret('openai', 'api_key', 'sk-from-credentials');

    const { runGroundingLoop } = await import('#shared/server/runtime/pi-agent-loop');
    runAgentLoopMock.mockImplementation(async (_prompts, _agentContext, config) => {
      expect(await config.getApiKey?.('openai')).toBe('sk-from-env');
      return [finalAssistantMessage()];
    });

    await runGroundingLoop({
      context: baseContext(),
      workspace: { id: 'workspace', provider: 'slack' as const, externalWorkspaceId: 'workspace', name: 'Workspace' },
      provider: 'openai',
      maxToolCallsPerRun: 6,
      retrievalToolNames: [],
      defaultToolInput: (_, toolInput) => toolInput,
      enrichToolOutput: async (_, output) => output,
      linkThreadArtifact: () => undefined
    });
  });

  it('adds encrypted reasoning continuity for stateless OpenAI Responses tool turns', async () => {
    const { runGroundingLoop } = await import('#shared/server/runtime/pi-agent-loop');
    runAgentLoopMock.mockImplementation(async (_prompts, _agentContext, config) => {
      const payload = config.onPayload?.({
        model: 'gpt-5.5',
        input: [],
        stream: true,
        store: false,
        include: ['file_search_call.results', 'reasoning.encrypted_content']
      }, config.model);

      expect(payload).toEqual({
        model: 'gpt-5.5',
        input: [],
        stream: true,
        store: false,
        include: ['file_search_call.results', 'reasoning.encrypted_content']
      });
      return [finalAssistantMessage()];
    });

    await runGroundingLoop({
      context: baseContext(),
      workspace: { id: 'workspace', provider: 'slack' as const, externalWorkspaceId: 'workspace', name: 'Workspace' },
      provider: 'openai',
      model: 'gpt-5.5',
      maxToolCallsPerRun: 6,
      retrievalToolNames: [],
      defaultToolInput: (_, toolInput) => toolInput,
      enrichToolOutput: async (_, output) => output,
      linkThreadArtifact: () => undefined
    });
  });

  it('does not mutate non-Responses model payloads', async () => {
    const { runGroundingLoop } = await import('#shared/server/runtime/pi-agent-loop');
    runAgentLoopMock.mockImplementation(async (_prompts, _agentContext, config) => {
      const payload = {
        model: 'claude-opus-4-7',
        messages: [],
        stream: true
      };

      expect(config.onPayload?.(payload, config.model)).toBeUndefined();
      return [finalAssistantMessage()];
    });

    await runGroundingLoop({
      context: baseContext(),
      workspace: { id: 'workspace', provider: 'slack' as const, externalWorkspaceId: 'workspace', name: 'Workspace' },
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      maxToolCallsPerRun: 6,
      retrievalToolNames: [],
      defaultToolInput: (_, toolInput) => toolInput,
      enrichToolOutput: async (_, output) => output,
      linkThreadArtifact: () => undefined
    });
  });

  it('blocks tools that are not in availableTools', async () => {
    const { getToolRegistry } = await import('#shared/server/capabilities/tool-registry');
    const { runGroundingLoop } = await import('#shared/server/runtime/pi-agent-loop');
    const registry = getToolRegistry();
    registry.register({
      name: 'hidden.search',
      description: '',
      sideEffectClass: 'read',
      async execute() {
        return { ok: true };
      }
    });

    runAgentLoopMock.mockImplementation(async (prompts, agentContext, config, emit) => {
      const hiddenAlias = alias('hidden.search');
      const assistantMessage = {
        role: 'assistant' as const,
        content: [{ type: 'toolCall' as const, id: 'call-1', name: hiddenAlias, arguments: {} }],
        api: 'openai',
        provider: 'openai',
        model: 'gpt-5.4-mini',
        usage,
        stopReason: 'toolUse' as const,
        timestamp: Date.now()
      };
      const toolCall = assistantMessage.content[0];
      emit({ type: 'turn_start' });
      emit({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: hiddenAlias, args: {} });
      const decision = await config.beforeToolCall?.({ assistantMessage, toolCall, args: {}, context: agentContext });
      emit({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: hiddenAlias,
        result: { content: [{ type: 'text' as const, text: JSON.stringify({ error: decision?.reason }) }], details: decision?.reason },
        isError: true
      });
      emit({
        type: 'message_end',
        message: {
          role: 'toolResult' as const,
          toolCallId: 'call-1',
          toolName: hiddenAlias,
          content: [{ type: 'text' as const, text: JSON.stringify({ error: decision?.reason }) }],
          details: decision?.reason,
          isError: true,
          timestamp: Date.now()
        }
      });
      return [finalAssistantMessage()];
    });

    const result = await runGroundingLoop({
      context: baseContext(),
      workspace: { id: 'workspace', provider: 'slack' as const, externalWorkspaceId: 'workspace', name: 'Workspace' },
      provider: 'openai',
      maxToolCallsPerRun: 6,
      retrievalToolNames: [],
      defaultToolInput: (_, toolInput) => toolInput,
      enrichToolOutput: async (_, output) => output,
      linkThreadArtifact: () => undefined
    });

    expect(result.toolResults).toEqual([
      {
        id: 'call-1',
        name: 'hidden.search',
        ok: false,
        error: 'Tool is not available for model-directed read-only use'
      }
    ]);
  });

  it('blocks tools whose sideEffectClass is not read', async () => {
    const { getToolRegistry } = await import('#shared/server/capabilities/tool-registry');
    const { runGroundingLoop } = await import('#shared/server/runtime/pi-agent-loop');
    const registry = getToolRegistry();
    registry.register({
      name: 'memory.thread.link_artifact',
      description: '',
      sideEffectClass: 'write',
      async execute() {
        return { ok: true };
      }
    });

    runAgentLoopMock.mockImplementation(async (prompts, agentContext, config) => {
      const decision = await config.beforeToolCall?.({
        assistantMessage: finalAssistantMessage(),
        toolCall: { type: 'toolCall', id: 'call-1', name: alias('memory.thread.link_artifact'), arguments: {} },
        args: {},
        context: agentContext
      });

      expect(decision).toEqual({
        block: true,
        reason: 'Tool is not available for model-directed read-only use'
      });

      return [finalAssistantMessage()];
    });

    await runGroundingLoop({
      context: {
        ...baseContext(),
        availableTools: [{ name: 'memory.thread.link_artifact', description: '', sideEffectClass: 'write' }]
      },
      workspace: { id: 'workspace', provider: 'slack' as const, externalWorkspaceId: 'workspace', name: 'Workspace' },
      provider: 'openai',
      maxToolCallsPerRun: 6,
      retrievalToolNames: [],
      defaultToolInput: (_, toolInput) => toolInput,
      enrichToolOutput: async (_, output) => output,
      linkThreadArtifact: () => undefined
    });
  });

  it('enforces MAX_TOOL_CALLS_PER_RUN', async () => {
    const { getToolRegistry } = await import('#shared/server/capabilities/tool-registry');
    const { runGroundingLoop } = await import('#shared/server/runtime/pi-agent-loop');
    const registry = getToolRegistry();
    registry.register({
      name: 'notion.search',
      description: '',
      sideEffectClass: 'read',
      async execute() {
        return { ok: true };
      }
    });

    runAgentLoopMock.mockImplementation(async (prompts, agentContext, config) => {
      const first = await config.beforeToolCall?.({
        assistantMessage: finalAssistantMessage(),
        toolCall: { type: 'toolCall', id: 'call-1', name: alias('notion.search'), arguments: {} },
        args: {},
        context: agentContext
      });
      const second = await config.beforeToolCall?.({
        assistantMessage: finalAssistantMessage(),
        toolCall: { type: 'toolCall', id: 'call-2', name: alias('notion.search'), arguments: {} },
        args: {},
        context: agentContext
      });

      expect(first).toBeUndefined();
      expect(second).toEqual({ block: true, reason: 'Tool-call cap reached' });

      return [finalAssistantMessage()];
    });

    await runGroundingLoop({
      context: {
        ...baseContext(),
        availableTools: [{ name: 'notion.search', description: '', sideEffectClass: 'read' }]
      },
      workspace: { id: 'workspace', provider: 'slack' as const, externalWorkspaceId: 'workspace', name: 'Workspace' },
      provider: 'openai',
      maxToolCallsPerRun: 1,
      retrievalToolNames: ['notion.search'],
      defaultToolInput: (_, toolInput) => toolInput,
      enrichToolOutput: async (_, output) => output,
      linkThreadArtifact: () => undefined
    });
  });

});
