import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotSession, ContinuityTask, ModelProvider, ProviderDraftResult, SkillManifest, Workspace } from '../../shared/types';

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
let deterministicRetrievalLog: string[] = [];
let delayNotionSearch = false;
let testSkills: SkillManifest[] = [];
let enabledOptionalTools: string[] = [];
let enabledContextSources: string[] = [];
let failInitialFetchThread = false;
const runAgentLoopMock = vi.fn();

const provider: ModelProvider = {
  name: 'openai',
  async classifyPolicyExecution() {
    return {
      execution: 'send',
      matchedTopics: [],
      matchedRuleIds: [],
      reason: 'test execution classification',
      confidence: 1
    };
  },
  async summarizeAndPropose(): Promise<ProviderDraftResult> {
    return fallbackDraft;
  }
};

vi.mock('#shared/server/providers/index', () => ({
  getModelProvider: () => provider
}));

vi.mock('#shared/server/skills/loader', () => ({
  loadSkills: async (): Promise<SkillManifest[]> => testSkills
}));

vi.mock('@earendil-works/pi-agent-core', async () => {
  const actual = await vi.importActual<typeof import('@earendil-works/pi-agent-core')>('@earendil-works/pi-agent-core');

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
  const testRoot = mkdtempSync(join(tmpdir(), 'murph-agent-runtime-events-'));
  process.env.MURPH_SQLITE_PATH = join(testRoot, 'murph.sqlite');
  process.env.MURPH_MEMORY_PATH = join(testRoot, 'memory');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';

  const { getToolRegistry } = await import('#shared/server/capabilities/tool-registry');
  const { getContextSourceRegistry } = await import('#shared/server/capabilities/context-source-registry');
  const { AgentRuntime } = await import('#shared/server/runtime/agent-runtime');
  const registry = getToolRegistry();
  const contextSources = getContextSourceRegistry();

  registry.register({
    name: 'channel.fetch_thread',
    description: '',
    sideEffectClass: 'read',
    async execute(): Promise<unknown> {
      if (failInitialFetchThread) {
        throw new Error('missing_scope');
      }
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
        enabledContextSources,
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
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    },
    requiresWorkspaceEnablement: true,
    async execute(): Promise<unknown> {
      deterministicRetrievalLog.push('notion.search:start');
      if (delayNotionSearch) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      deterministicRetrievalLog.push('notion.search:end');
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
  registry.register({
    name: 'github.search',
    description: '',
    sideEffectClass: 'read',
    knowledgeDomains: ['code', 'documentation'],
    retrievalEligible: true,
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    },
    requiresWorkspaceEnablement: true,
    async execute(input: { query: string; limit?: number }): Promise<unknown> {
      deterministicRetrievalLog.push('github.search:start');
      deterministicRetrievalLog.push('github.search:end');
      return {
        results: [{
          id: 'github:42',
          repository: 'acme/app',
          number: 42,
          title: 'API requests are unbounded — need per-tenant rate limiting before Acme launch',
          body: `query=${input.query}; Acme rate limiting issue is open.`,
          kind: 'issue',
          url: 'https://github.test/acme/app/issues/42'
        }]
      };
    }
  });

  contextSources.register({
    name: 'notion.thread_search',
    description: '',
    optional: true,
    knowledgeDomains: ['documentation'],
    async retrieve() {
      return [{
        id: 'notion:rate-limit',
        source: 'notion',
        type: 'document',
        title: 'API Rate Limiting',
        text: 'Enterprise | 3000 | 200'
      }];
    }
  }, { optional: true, source: 'test' });
  contextSources.register({
    name: 'gmail.thread_search',
    description: '',
    optional: true,
    knowledgeDomains: ['email'],
    async retrieve() {
      return [{
        id: 'gmail:acme-thread',
        source: 'gmail',
        type: 'email',
        title: 'Acme Corp API rate limiting',
        text: 'Acme integration team expects ~800 req/s during peak sync windows.'
      }];
    }
  }, { optional: true, source: 'test' });

  return new AgentRuntime();
}

function notionSkill(): SkillManifest {
  return {
    name: 'notion-docs',
    description: '',
    channelNames: ['slack'],
    contextSourceNames: ['notion.thread_search'],
    knowledgeDomains: ['documentation'],
    groundingPolicy: 'required_when_no_artifacts',
    sessionModes: ['manual_review'],
    priority: 120,
    riskLevel: 'low',
    instructions: ''
  };
}

function githubSkill(): SkillManifest {
  return {
    ...notionSkill(),
    name: 'github-code',
    contextSourceNames: ['github.thread_search'],
    knowledgeDomains: ['code', 'documentation'],
    groundingPolicy: 'required_when_no_artifacts',
    priority: 105
  };
}

function googleSkill(): SkillManifest {
  return {
    ...notionSkill(),
    name: 'google-workspace',
    contextSourceNames: ['gmail.thread_search'],
    knowledgeDomains: ['email', 'calendar', 'team'],
    groundingPolicy: 'required_when_no_artifacts',
    priority: 115
  };
}

function task(overrides: Partial<ContinuityTask> = {}): ContinuityTask {
  return {
    id: 'task-1',
    source: 'slack_event',
    workspaceId: 'T1',
    thread: { provider: 'slack', channelId: 'C1', threadTs: '111.222' },
    targetUserId: 'UOWNER',
    actorUserId: 'UASKER',
    receivedAt: new Date().toISOString(),
    ...overrides
  };
}

function session(): AutopilotSession {
  return {
    id: 'session-1',
    workspaceId: 'T1',
    ownerUserId: 'UOWNER',
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
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test',
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
    deterministicRetrievalLog = [];
    delayNotionSearch = false;
    failInitialFetchThread = false;
    enabledOptionalTools = [];
    enabledContextSources = [];
    testSkills = [];
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

  it('continues when the initial channel thread fetch fails', async () => {
    failInitialFetchThread = true;

    const runtime = await setupRuntime();
    const result = await runtime.run(task(), session(), workspace());

    expect(result.proposedAction.type).toBe('ask');
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent.model.failed',
          payload: expect.objectContaining({
            phase: 'tool_turn'
          })
        })
      ])
    );
  });

  it('uses the triggering event message when the initial channel thread fetch fails', async () => {
    failInitialFetchThread = true;
    const triggerMessage = {
      provider: 'slack' as const,
      userId: 'UASKER',
      authorId: 'UASKER',
      text: '<@UOWNER> is dark mode good now?',
      ts: '111.222',
      messageId: '111.222'
    };
    runAgentLoopMock.mockResolvedValueOnce([finalAssistantMessage(fallbackDraft)]);

    const runtime = await setupRuntime();
    const result = await runtime.run(task({ triggerMessage }), session(), workspace());

    expect(result.context.thread.latestMessage).toBe(triggerMessage.text);
    expect(result.context.thread.recentMessages).toEqual([triggerMessage]);
  });

  it('does not run retrieval when the model abstains from an irrelevant trigger', async () => {
    testSkills = [notionSkill(), githubSkill()];
    enabledContextSources = ['notion.thread_search', 'github.thread_search'];
    enabledOptionalTools = ['notion.search', 'notion.read_page', 'github.search'];
    const draft: ProviderDraftResult = {
      continuityCase: 'unknown',
      summary: '<@UOWNER> unrelated token-shaped text',
      unresolvedQuestions: [],
      proposedAction: {
        type: 'abstain',
        message: '',
        reason: 'The trigger message is random text and does not contain a continuity request.',
        confidence: 0.95
      }
    };
    runAgentLoopMock.mockResolvedValueOnce([finalAssistantMessage(draft)]);

    const runtime = await setupRuntime();
    const result = await runtime.run(task({
      triggerMessage: {
        provider: 'slack',
        userId: 'UASKER',
        authorId: 'UASKER',
        text: '<@UOWNER> unrelated token-shaped text',
        ts: '111.222',
        messageId: '111.222'
      }
    }), session(), workspace());

    expect(result.proposedAction.type).toBe('abstain');
    expect(result.context.thread.latestMessage).toBe('<@UOWNER> unrelated token-shaped text');
    expect(result.runtimeEvents.filter((event) => event.type === 'agent.tool.requested')).toEqual([]);
    expect(deterministicRetrievalLog).toEqual([]);
  });

  it('fans out all enabled retrieval tools when the model calls runtime.retrieve_all', async () => {
    testSkills = [notionSkill(), githubSkill()];
    enabledContextSources = ['notion.thread_search', 'github.thread_search'];
    enabledOptionalTools = ['notion.search', 'notion.read_page', 'github.search'];
    runAgentLoopMock.mockImplementation(async (prompts, agentContext, config, emit) => {
      emit({ type: 'turn_start' });
      await executeToolCall(
        agentContext,
        config,
        emit,
        'runtime.retrieve_all',
        { requestFocus: 'checkout launch readiness' },
        'call-retrieve-all'
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
      autoReadPageTitle: 'Checkout launch readiness',
      keys: ['results', 'strategy', 'autoReadPage']
    });
    expect(deterministicRetrievalLog).toEqual([
      'notion.search:start',
      'notion.search:end',
      'github.search:start',
      'github.search:end'
    ]);
    expect(result.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent.tool.requested',
          payload: expect.objectContaining({
            name: 'runtime.retrieve_all',
            reason: 'Model requested tool call'
          })
        }),
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

});
