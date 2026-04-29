import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotSession, ContinuityTask, ModelProvider, ProviderDraftResult, SkillManifest, Workspace } from '../../src/lib/types';

const fallbackDraft: ProviderDraftResult = {
  continuityCase: 'clarification',
  summary: 'Fallback summary',
  unresolvedQuestions: [],
  proposedAction: {
    type: 'ask',
    message: 'Can you share the source of truth?',
    reason: 'Fallback completed after native tool turn failed.',
    confidence: 0.75
  }
};

let capturedUserPreferencesInput: unknown;
let capturedThreadReadInput: unknown;
let capturedSearchResult: unknown;
let testSkills: SkillManifest[] = [];
let enabledOptionalTools: string[] = [];
const runAgentLoopMock = vi.fn();

const provider: ModelProvider = {
  name: 'openai',
  async summarizeAndPropose(): Promise<ProviderDraftResult> {
    return fallbackDraft;
  }
};

vi.mock('#lib/server/providers/index', () => ({
  getModelProvider: () => provider
}));

vi.mock('#lib/server/skills/loader', () => ({
  loadSkills: async (): Promise<SkillManifest[]> => testSkills
}));

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

function finalAssistantMessage(draft: ProviderDraftResult) {
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

async function executeToolCall(
  agentContext: { tools?: Array<{ name: string; execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: unknown }> }> },
  config: {
    beforeToolCall?: (context: unknown) => Promise<{ block?: boolean; reason?: string } | undefined>;
    afterToolCall?: (context: unknown) => Promise<{ content?: Array<{ type: 'text'; text: string }>; details?: unknown } | undefined>;
  },
  emit: (event: unknown) => void,
  name: string,
  args: Record<string, unknown>,
  id: string
) {
  const toolAlias = alias(name);
  const assistantMessage = {
    role: 'assistant' as const,
    content: [{ type: 'toolCall' as const, id, name: toolAlias, arguments: args }],
    api: 'openai',
    provider: 'openai',
    model: 'gpt-5.4-mini',
    usage,
    stopReason: 'toolUse' as const,
    timestamp: Date.now()
  };
  const toolCall = assistantMessage.content[0];
  const before = await config.beforeToolCall?.({
    assistantMessage,
    toolCall,
    args,
    context: agentContext
  });

  emit({ type: 'tool_execution_start', toolCallId: id, toolName: toolAlias, args });

  if (before?.block) {
    const blockedContent = [{ type: 'text' as const, text: JSON.stringify({ error: before.reason }) }];
    emit({
      type: 'tool_execution_end',
      toolCallId: id,
      toolName: toolAlias,
      result: { content: blockedContent, details: before.reason },
      isError: true
    });
    emit({
      type: 'message_end',
      message: {
        role: 'toolResult' as const,
        toolCallId: id,
        toolName: toolAlias,
        content: blockedContent,
        details: before.reason,
        isError: true,
        timestamp: Date.now()
      }
    });
    return;
  }

  const tool = agentContext.tools?.find((entry) => entry.name === toolAlias);
  if (!tool) {
    throw new Error(`Missing tool: ${toolAlias}`);
  }

  const result = await tool.execute(id, args);
  const after = await config.afterToolCall?.({
    assistantMessage,
    toolCall,
    args,
    result,
    isError: false,
    context: agentContext
  });
  const finalized = {
    ...result,
    content: after?.content ?? result.content,
    details: after?.details ?? result.details
  };

  emit({
    type: 'tool_execution_end',
    toolCallId: id,
    toolName: toolAlias,
    result: finalized,
    isError: false
  });
  emit({
    type: 'message_end',
    message: {
      role: 'toolResult' as const,
      toolCallId: id,
      toolName: toolAlias,
      content: finalized.content,
      details: finalized.details,
      isError: false,
      timestamp: Date.now()
    }
  });
}

async function setupRuntime() {
  vi.resetModules();
  process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-agent-runtime-events-')), 'murph.sqlite');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';

  const { getToolRegistry } = await import('#lib/server/capabilities/tool-registry');
  const { AgentRuntime } = await import('#lib/server/runtime/agent-runtime');
  const registry = getToolRegistry();

  registry.register({
    name: 'channel.fetch_thread',
    description: '',
    sideEffectClass: 'read',
    async execute(): Promise<unknown> {
      return [
        {
          provider: 'slack',
          userId: 'UASKER',
          text: '<@UOWNER> can you confirm status?',
          ts: '111.222',
          messageId: 'm1'
        }
      ];
    }
  });
  registry.register({
    name: 'user.get_preferences',
    description: '',
    sideEffectClass: 'read',
    async execute(input: unknown): Promise<unknown> {
      capturedUserPreferencesInput = input;
      return { userId: 'UOWNER', preferences: [], forbiddenTopics: [], routingHints: [] };
    }
  });
  registry.register({
    name: 'memory.workspace.read',
    description: '',
    sideEffectClass: 'read',
    async execute(input: { workspaceId: string }): Promise<unknown> {
      return {
        workspaceId: input.workspaceId,
        channelMappings: [],
        escalationRules: [],
        enabledOptionalTools,
        enabledContextSources: [],
        enabledPlugins: []
      };
    }
  });
  registry.register({
    name: 'memory.thread.read',
    description: '',
    sideEffectClass: 'read',
    async execute(input: { workspaceId: string; channelId: string; threadTs: string }): Promise<unknown> {
      capturedThreadReadInput = input;
      return {
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        threadTs: input.threadTs,
        linkedArtifacts: [],
        openQuestions: [],
        blockerNotes: []
      };
    }
  });
  registry.register({
    name: 'notion.search',
    description: '',
    sideEffectClass: 'read',
    knowledgeDomains: ['documentation'],
    retrievalEligible: true,
    requiresWorkspaceEnablement: true,
    async execute(): Promise<unknown> {
      return {
        results: [{ id: 'page-1', title: 'Checkout launch readiness', url: 'https://notion.test/page-1' }],
        strategy: 'notion_api_search'
      };
    }
  });
  registry.register({
    name: 'notion.read_page',
    description: '',
    sideEffectClass: 'read',
    knowledgeDomains: ['documentation'],
    retrievalEligible: false,
    requiresWorkspaceEnablement: true,
    async execute(): Promise<unknown> {
      return {
        id: 'page-1',
        title: 'Checkout launch readiness',
        url: 'https://notion.test/page-1',
        text: 'Checkout is not cleared for go-live. Hold until mobile wallet failures are below threshold.'
      };
    }
  });

  return new AgentRuntime();
}

function channelSkill(): SkillManifest {
  return {
    name: 'channel-continuity',
    description: '',
    triggers: ['status'],
    allowedActions: ['reply', 'ask', 'redirect', 'defer', 'remind', 'abstain'],
    toolNames: ['channel.fetch_thread', 'user.get_preferences', 'memory.workspace.read', 'memory.thread.read'],
    channelNames: ['slack'],
    contextSourceNames: [],
    knowledgeRequirements: [],
    sessionModes: ['manual_review'],
    appliesTo: ['channel_thread'],
    priority: 100,
    riskLevel: 'low',
    abstainConditions: [],
    instructions: ''
  };
}

function documentationSkill(): SkillManifest {
  return {
    ...channelSkill(),
    name: 'documentation-grounded-continuity',
    triggers: ['status'],
    toolNames: ['channel.fetch_thread'],
    knowledgeDomains: ['documentation'],
    groundingPolicy: 'required_when_no_artifacts',
    priority: 120
  };
}

function task(): ContinuityTask {
  return {
    id: 'task-1',
    source: 'slack_event',
    workspaceId: 'T1',
    thread: { provider: 'slack', channelId: 'C1', threadTs: '111.222' },
    targetUserId: 'UOWNER',
    actorUserId: 'UASKER',
    receivedAt: new Date().toISOString()
  };
}

function session(): AutopilotSession {
  return {
    id: 'session-1',
    workspaceId: 'T1',
    ownerSlackUserId: 'UOWNER',
    title: 'Coverage',
    mode: 'manual_review',
    status: 'active',
    channelScope: ['C1'],
    startedAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 60_000).toISOString()
  };
}

function workspace(): Workspace {
  return {
    id: 'T1',
    slackTeamId: 'T1',
    name: 'Test',
    botTokenEncrypted: 'token',
    botUserId: 'UTZBOT',
    installedAt: new Date().toISOString()
  };
}

describe('AgentRuntime model failure events', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    runAgentLoopMock.mockReset();
    capturedUserPreferencesInput = undefined;
    capturedThreadReadInput = undefined;
    capturedSearchResult = undefined;
    enabledOptionalTools = [];
    testSkills = [channelSkill()];
    runAgentLoopMock.mockImplementation(async () => {
      throw new Error('Native tool call request failed');
    });
  });

  it('emits agent.model.failed before falling back when native tool turn fails', async () => {
    const runtime = await setupRuntime();
    const result = await runtime.run(task(), session(), workspace());

    expect(result.proposedAction.type).toBe('ask');
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        {
          type: 'agent.model.failed',
          payload: {
            provider: 'openai',
            phase: 'tool_turn',
            error: 'Native tool call request failed'
          }
        },
        {
          type: 'agent.model.started',
          payload: {
            provider: 'openai',
            round: 'fallback'
          }
        }
      ])
    );
  });

  it('defaults model-directed context tool inputs from the active task context', async () => {
    runAgentLoopMock.mockImplementation(async (prompts, agentContext, config, emit) => {
      emit({ type: 'turn_start' });
      await executeToolCall(agentContext, config, emit, 'user.get_preferences', {}, 'call-user');
      await executeToolCall(agentContext, config, emit, 'memory.thread.read', {}, 'call-thread');
      return [finalAssistantMessage(fallbackDraft)];
    });

    const runtime = await setupRuntime();
    await runtime.run(task(), session(), workspace());

    expect(capturedUserPreferencesInput).toEqual({
      workspaceId: 'T1',
      userId: 'UOWNER'
    });
    expect(capturedThreadReadInput).toEqual({
      workspaceId: 'T1',
      channelId: 'C1',
      threadTs: '111.222'
    });
  });

  it('auto-reads the first Notion search result for required grounding', async () => {
    testSkills = [documentationSkill(), channelSkill()];
    enabledOptionalTools = ['notion.search', 'notion.read_page'];
    runAgentLoopMock.mockImplementation(async (prompts, agentContext, config, emit) => {
      emit({ type: 'turn_start' });
      await executeToolCall(
        agentContext,
        config,
        emit,
        'notion.search',
        { query: 'checkout launch readiness', limit: 3 },
        'call-search'
      );
      return [finalAssistantMessage(fallbackDraft)];
    });

    const runtime = await setupRuntime();
    const result = await runtime.run(task(), session(), workspace());

    const searchEvent = result.runtimeEvents.find((event) => (
      event.type === 'agent.tool.completed' &&
      (event.payload as { name?: string }).name === 'notion.search'
    ));
    capturedSearchResult = (searchEvent?.payload as { outputSummary?: unknown })?.outputSummary;

    expect(capturedSearchResult).toEqual({
      resultCount: 1,
      titles: ['Checkout launch readiness'],
      strategy: 'notion_api_search',
      scannedAllowedPageCount: undefined,
      autoReadPageTitle: 'Checkout launch readiness',
      keys: ['results', 'strategy', 'autoReadPage']
    });
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent.tool.completed',
          payload: expect.objectContaining({
            name: 'notion.search',
            ok: true,
            outputSummary: expect.objectContaining({
              resultCount: 1,
              strategy: 'notion_api_search',
              autoReadPageTitle: 'Checkout launch readiness'
            })
          })
        }),
        expect.objectContaining({
          type: 'agent.tool.completed',
          payload: expect.objectContaining({
            name: 'notion.read_page',
            ok: true,
            outputSummary: expect.objectContaining({
              title: 'Checkout launch readiness',
              textLength: 91
            })
          })
        })
      ])
    );
    expect(result.context.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'notion:page-1',
          source: 'notion',
          type: 'document',
          title: 'Checkout launch readiness'
        })
      ])
    );
    expect(result.context.linkedArtifacts).toContain('https://notion.test/page-1');
  });

  it('broadens available tools for factual questions even when only channel-continuity is selected', async () => {
    enabledOptionalTools = ['notion.search', 'notion.read_page'];
    runAgentLoopMock.mockImplementation(async () => [finalAssistantMessage(fallbackDraft)]);

    const runtime = await setupRuntime();
    const result = await runtime.run(task(), session(), workspace());

    expect(result.context.skills.map((skill) => skill.name)).toEqual(['channel-continuity']);
    expect(result.context.availableTools.map((tool) => tool.name)).toEqual([
      'channel.fetch_thread',
      'user.get_preferences',
      'memory.workspace.read',
      'memory.thread.read',
      'notion.search'
    ]);
  });
});
