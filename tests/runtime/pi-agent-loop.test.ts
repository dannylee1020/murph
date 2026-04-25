import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderDraftResult } from '../../src/lib/types';

const runAgentLoopMock = vi.fn();

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
  });

  it('blocks tools that are not in availableTools', async () => {
    const { getToolRegistry } = await import('#lib/server/capabilities/tool-registry');
    const { runGroundingLoop } = await import('#lib/server/runtime/pi-agent-loop');
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
      workspace: { id: 'workspace', slackTeamId: 'workspace', name: 'Workspace' },
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
    const { getToolRegistry } = await import('#lib/server/capabilities/tool-registry');
    const { runGroundingLoop } = await import('#lib/server/runtime/pi-agent-loop');
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
      workspace: { id: 'workspace', slackTeamId: 'workspace', name: 'Workspace' },
      provider: 'openai',
      maxToolCallsPerRun: 6,
      retrievalToolNames: [],
      defaultToolInput: (_, toolInput) => toolInput,
      enrichToolOutput: async (_, output) => output,
      linkThreadArtifact: () => undefined
    });
  });

  it('enforces MAX_TOOL_CALLS_PER_RUN', async () => {
    const { getToolRegistry } = await import('#lib/server/capabilities/tool-registry');
    const { runGroundingLoop } = await import('#lib/server/runtime/pi-agent-loop');
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
      workspace: { id: 'workspace', slackTeamId: 'workspace', name: 'Workspace' },
      provider: 'openai',
      maxToolCallsPerRun: 1,
      retrievalToolNames: ['notion.search'],
      defaultToolInput: (_, toolInput) => toolInput,
      enrichToolOutput: async (_, output) => output,
      linkThreadArtifact: () => undefined
    });
  });

  it('maps tool_execution_end once and preserves tool-result source order', async () => {
    const { getToolRegistry } = await import('#lib/server/capabilities/tool-registry');
    const { runGroundingLoop } = await import('#lib/server/runtime/pi-agent-loop');
    const registry = getToolRegistry();
    registry.register({
      name: 'notion.search',
      description: '',
      sideEffectClass: 'read',
      async execute(input: { query: string }) {
        return { query: input.query };
      }
    });

    runAgentLoopMock.mockImplementation(async (prompts, agentContext, config, emit) => {
      emit({ type: 'turn_start' });
      const notionAlias = alias('notion.search');
      const tool = agentContext.tools?.find((entry) => entry.name === notionAlias);
      if (!tool) {
        throw new Error('Missing notion.search tool alias');
      }

      const resultOne = await tool.execute('call-1', { query: 'first' });
      const resultTwo = await tool.execute('call-2', { query: 'second' });

      emit({ type: 'tool_execution_end', toolCallId: 'call-2', toolName: notionAlias, result: resultTwo, isError: false });
      emit({ type: 'tool_execution_end', toolCallId: 'call-1', toolName: notionAlias, result: resultOne, isError: false });
      emit({
        type: 'message_end',
        message: {
          role: 'toolResult' as const,
          toolCallId: 'call-1',
          toolName: notionAlias,
          content: resultOne.content,
          details: resultOne.details,
          isError: false,
          timestamp: Date.now()
        }
      });
      emit({
        type: 'message_end',
        message: {
          role: 'toolResult' as const,
          toolCallId: 'call-2',
          toolName: notionAlias,
          content: resultTwo.content,
          details: resultTwo.details,
          isError: false,
          timestamp: Date.now()
        }
      });

      return [finalAssistantMessage()];
    });

    const result = await runGroundingLoop({
      context: {
        ...baseContext(),
        availableTools: [{ name: 'notion.search', description: '', sideEffectClass: 'read' }]
      },
      workspace: { id: 'workspace', slackTeamId: 'workspace', name: 'Workspace' },
      provider: 'openai',
      maxToolCallsPerRun: 6,
      retrievalToolNames: ['notion.search'],
      defaultToolInput: (_, toolInput) => toolInput,
      enrichToolOutput: async (_, output) => output,
      linkThreadArtifact: () => undefined
    });

    expect(result.toolResults.map((entry) => entry.id)).toEqual(['call-1', 'call-2']);
    expect(
      result.runtimeEvents
        .filter((event) => event.type === 'agent.tool.completed')
        .map((event) => (event.payload as { id: string }).id)
    ).toEqual(['call-2', 'call-1']);
  });

  it('fails fast on alias collisions', async () => {
    const { runGroundingLoop } = await import('#lib/server/runtime/pi-agent-loop');

    await expect(runGroundingLoop({
      context: {
        ...baseContext(),
        availableTools: [
          { name: 'notion.search', description: '', sideEffectClass: 'read' },
          { name: 'notion__search', description: '', sideEffectClass: 'read' }
        ]
      },
      workspace: { id: 'workspace', slackTeamId: 'workspace', name: 'Workspace' },
      provider: 'openai',
      maxToolCallsPerRun: 6,
      retrievalToolNames: ['notion.search', 'notion__search'],
      defaultToolInput: (_, toolInput) => toolInput,
      enrichToolOutput: async (_, output) => output,
      linkThreadArtifact: () => undefined
    })).rejects.toThrow('Tool alias collision');
  });
});
