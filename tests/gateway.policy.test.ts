import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentToolResult, ContextAssembly, ContinuityTask, SkillManifest } from '../src/lib/types';
import type { AgentRunResult } from '../src/lib/server/runtime/agent-runtime';

vi.mock('../src/lib/server/memory/markdown', () => ({
  writeThreadMemory: vi.fn().mockResolvedValue('test-thread-memory.md')
}));

function skill(): SkillManifest {
  return {
    name: 'notion-docs',
    description: '',
    channelNames: ['slack'],
    contextSourceNames: ['memory.linked_artifacts'],
    sessionModes: ['manual_review'],
    priority: 1,
    riskLevel: 'low',
    instructions: ''
  };
}

function task(overrides: Partial<ContinuityTask> = {}): ContinuityTask {
  return {
    id: `task-${Math.random()}`,
    source: 'slack_event',
    workspaceId: 'T1',
    thread: { provider: 'slack', channelId: 'C1', threadTs: '111.222' },
    targetUserId: 'UOWNER',
    actorUserId: 'UASKER',
    receivedAt: new Date().toISOString(),
    ...overrides
  };
}

function runResult(
  taskInput: ContinuityTask,
  workspaceId: string,
  overrides: {
    proposedAction?: Partial<AgentRunResult['proposedAction']>;
    summary?: string;
    unresolvedQuestions?: string[];
    toolResults?: AgentToolResult[];
    recentMessages?: ContextAssembly['thread']['recentMessages'];
  } = {}
): AgentRunResult {
  const context: ContextAssembly = {
    workspaceId,
    task: taskInput,
    targetUserId: taskInput.targetUserId,
    thread: {
      ref: taskInput.thread,
      latestMessage: '<@UOWNER> can you confirm this?',
      recentMessages: overrides.recentMessages ?? [
        {
          provider: 'slack',
          userId: taskInput.actorUserId,
          text: '<@UOWNER> can you confirm this?',
          ts: taskInput.thread.threadTs,
          messageId: 'm1'
        }
      ],
      participants: ['UOWNER', taskInput.actorUserId ?? 'UASKER']
    },
    memory: {
      user: { userId: 'UOWNER', preferences: [], forbiddenTopics: [], routingHints: [] },
      workspace: {
        workspaceId,
        channelMappings: [],
        escalationRules: [],
        enabledOptionalTools: [],
        enabledContextSources: [],
        enabledPlugins: []
      },
      thread: {
        workspaceId,
        channelId: taskInput.thread.channelId,
        threadTs: taskInput.thread.threadTs,
        linkedArtifacts: [],
        openQuestions: [],
        blockerNotes: []
      }
    },
    artifacts: [],
    skills: [skill()],
    availableTools: [{ name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' }],
    summary: overrides.summary ?? 'Owner was asked to confirm status.',
    unresolvedQuestions: overrides.unresolvedQuestions ?? [],
    continuityCase: 'clarification',
    linkedArtifacts: []
  };

  return {
    context,
    proposedAction: {
      type: 'reply',
      message: 'The owner is away; this is queued for review.',
      reason: 'Session is active and context is sufficient.',
      confidence: 0.9,
      ...overrides.proposedAction
    },
    selectedSkillNames: ['notion-docs'],
    toolsUsed: [],
    toolResults: overrides.toolResults ?? [{
      id: 'call-1',
      name: 'channel.fetch_thread',
      ok: true,
      output: { messages: 1 }
    }],
    runtimeEvents: []
  };
}

async function setup(
  overrides: {
    proposedAction?: Partial<AgentRunResult['proposedAction']>;
    summary?: string;
    unresolvedQuestions?: string[];
    toolResults?: AgentToolResult[];
    recentMessages?: ContextAssembly['thread']['recentMessages'];
    sessionMode?: 'manual_review' | 'auto_send_low_risk';
    policyExecution?: { execution: 'send' | 'queue' | 'abstain'; reason?: string; confidence?: number };
  } = {}
) {
  vi.resetModules();
  const testRoot = mkdtempSync(join(tmpdir(), 'murph-gateway-policy-'));
  process.env.MURPH_SQLITE_PATH = join(testRoot, 'murph.sqlite');
  process.env.MURPH_MEMORY_PATH = join(testRoot, 'memory');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  const fetchThread = vi.fn().mockResolvedValue([
    {
      provider: 'slack',
      userId: 'UASKER',
      text: 'Fetched fallback thread message',
      ts: '111.333',
      messageId: 'm2'
    }
  ]);
  const postReply = vi.fn();
  const postMessage = vi.fn();

  vi.doMock('#lib/server/capabilities/channel-registry', () => ({
    getChannelRegistry: () => ({
      register: vi.fn(),
      registerPlugin: vi.fn(),
      startIngress: vi.fn(),
      fetchThread,
      postReply,
      postMessage
    })
  }));
  const classifyPolicyExecution = vi.fn().mockResolvedValue({
    execution: overrides.policyExecution?.execution ?? 'send',
    matchedTopics: [],
    matchedRuleIds: [],
    reason: overrides.policyExecution?.reason ?? 'Policy execution allows sending.',
    confidence: overrides.policyExecution?.confidence ?? 0.95
  });

  vi.doMock('#lib/server/runtime/policy-classifier', () => ({
    classifyPolicyExecution
  }));

  const { getStore } = await import('#lib/server/persistence/store');
  const { getGateway } = await import('#lib/server/runtime/gateway');
  const { AgentRuntime } = await import('#lib/server/runtime/agent-runtime');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  store.upsertUser({
    workspaceId: workspace.id,
    externalUserId: 'UOWNER',
    displayName: 'Owner',
    workdayStartHour: 0,
    workdayEndHour: 23
  });
  store.createSession({
    workspaceId: workspace.id,
    ownerUserId: 'UOWNER',
    title: 'Coverage',
    mode: overrides.sessionMode ?? 'manual_review',
    channelScope: ['C1'],
    policy: {
      raw: '',
      compiled: {
        blockedTopics: [],
        alwaysQueueTopics: [],
        blockedActions: [],
        requireGroundingForFacts: false,
        preferAskWhenUncertain: true,
        allowAutoSend: overrides.sessionMode === 'auto_send_low_risk',
        notesForAgent: []
      },
      compiledAt: new Date().toISOString(),
      source: overrides.sessionMode === 'auto_send_low_risk' ? 'profile' : 'default',
      version: 2
    },
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  const runSpy = vi.spyOn(AgentRuntime.prototype, 'run').mockImplementation(async (input) => runResult(input, workspace.id, overrides));

  return { store, gateway: getGateway(), workspace, runSpy, classifyPolicyExecution, postReply, postMessage };
}

describe('Gateway session-first policy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes thread memory for clean runs', async () => {
    const { gateway, store, workspace } = await setup();

    await gateway.handleTask(task());

    const memory = store.getOrCreateThreadMemory(workspace.id, 'C1', '111.222');
    expect(memory.summary).toBe('Owner was asked to confirm status.');
    expect(memory.evidenceStatus?.status).toBe('complete');
    expect(memory.evidenceStatus?.attemptedTools).toEqual(['channel.fetch_thread']);
  });

  it('does not persist thread summary when all tool calls failed', async () => {
    const { gateway, store, workspace } = await setup({
      toolResults: [{
        id: 'call-1',
        name: 'calendar.check_availability',
        ok: false,
        error: 'Tool execution failed'
      }]
    });

    await gateway.handleTask(task());

    const memory = store.getOrCreateThreadMemory(workspace.id, 'C1', '111.222');
    expect(memory.summary).toBeUndefined();
    const runs = store.listAgentRuns(undefined, 1);
    const events = store.listAgentRunEvents(runs[0].id);
    expect(events.some((event) => event.type === 'agent.memory.skipped')).toBe(true);
    expect(events.some((event) => event.type === 'agent.memory.written')).toBe(false);
  });

  it('persists thread summary with partial evidence when at least one tool succeeds', async () => {
    const { gateway, store, workspace } = await setup({
      toolResults: [
        {
          id: 'call-1',
          name: 'notion.search',
          ok: true,
          output: { results: [{ title: 'Launch plan' }] }
        },
        {
          id: 'call-2',
          name: 'slack.search',
          ok: false,
          error: 'not_allowed_token_type'
        }
      ]
    });

    await gateway.handleTask(task());

    const memory = store.getOrCreateThreadMemory(workspace.id, 'C1', '111.222');
    expect(memory.summary).toBe('Owner was asked to confirm status.');
    expect(memory.evidenceStatus).toMatchObject({
      status: 'partial',
      successfulTools: [expect.objectContaining({ name: 'notion.search' })],
      failedTools: [expect.objectContaining({ name: 'slack.search', error: 'not_allowed_token_type' })]
    });
    const runs = store.listAgentRuns(undefined, 1);
    const events = store.listAgentRunEvents(runs[0].id);
    expect(events.some((event) => event.type === 'agent.memory.written')).toBe(true);
  });

  it('persists unresolved questions but not summary for ask actions', async () => {
    const { gateway, store, workspace } = await setup({
      proposedAction: {
        type: 'ask',
        message: 'What time works?',
        reason: 'Needs a specific time window.',
        confidence: 0.92
      },
      summary: 'Calendar says next Thursday is unavailable.',
      unresolvedQuestions: ['What time window should be checked?']
    });

    await gateway.handleTask(task());

    const memory = store.getOrCreateThreadMemory(workspace.id, 'C1', '111.222');
    expect(memory.summary).toBeUndefined();
    expect(memory.openQuestions).toEqual(['What time window should be checked?']);
    const runs = store.listAgentRuns(undefined, 1);
    const events = store.listAgentRunEvents(runs[0].id);
    expect(events.some((event) => event.type === 'agent.memory.skipped')).toBe(true);
  });

  it('abstains when the event actor is the session owner', async () => {
    const { gateway, runSpy } = await setup();

    const audit = await gateway.handleTask(task({ actorUserId: 'UOWNER' }));

    expect(runSpy).not.toHaveBeenCalled();
    expect(audit.disposition).toBe('abstained');
    expect(audit.policyReason).toBe('Event actor is the session owner');
  });

  it('runs the main agent before policy execution abstains', async () => {
    const { gateway, runSpy } = await setup({
      policyExecution: {
        execution: 'abstain',
        reason: 'Request matches a blocked policy topic.',
        confidence: 0.91
      }
    });

    const audit = await gateway.handleTask(task());

    expect(runSpy).toHaveBeenCalledOnce();
    expect(audit.disposition).toBe('abstained');
    expect(audit.policyReason).toBe('Request matches a blocked policy topic.');
  });

  it('queues the main agent draft when policy execution requires review', async () => {
    const { gateway, store, workspace, runSpy } = await setup({
      policyExecution: {
        execution: 'queue',
        reason: 'Request is policy-sensitive and needs operator review.',
        confidence: 0.7
      }
    });

    const audit = await gateway.handleTask(task());

    expect(runSpy).toHaveBeenCalledOnce();
    expect(audit.disposition).toBe('queued');
    const queue = store.listReviewQueue(workspace.id);
    expect(queue[0]).toEqual(expect.objectContaining({
      action: 'reply',
      message: 'The owner is away; this is queued for review.',
      reason: 'Session is active and context is sufficient.'
    }));
  });

  it('approves queued Discord replies with provider-specific thread metadata', async () => {
    const { gateway, store, postReply } = await setup();
    const discordWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Discord Guild',
      botUserId: 'DBOT'
    });
    const item = store.insertAction({
      workspaceId: discordWorkspace.id,
      sessionId: undefined,
      channelId: 'PARENT1',
      threadTs: 'THREAD1',
      targetUserId: 'UOWNER',
      actionType: 'reply',
      disposition: 'queued',
      message: 'Approved Discord reply',
      reason: 'Needs operator approval',
      confidence: 0.8,
      contextSnapshot: {
        summary: 'Discord thread summary',
        continuityCase: 'clarification',
        thread: {
          provider: 'discord',
          channelId: 'PARENT1',
          threadTs: 'THREAD1',
          threadChannelId: 'THREAD1',
          messages: []
        }
      }
    });

    await gateway.handleReviewAction(item.id, { action: 'approve_send' });

    expect(postReply).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'discord' }),
      expect.objectContaining({
        provider: 'discord',
        channelId: 'PARENT1',
        threadTs: 'THREAD1',
        threadChannelId: 'THREAD1'
      }),
      'Approved Discord reply'
    );
  });

  it('falls back for legacy queued Discord replies without thread metadata', async () => {
    const { gateway, store, postReply } = await setup();
    postReply.mockRejectedValueOnce(new Error('Failed to post Discord message: Unknown Channel'));
    const discordWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Discord Guild',
      botUserId: 'DBOT'
    });
    const item = store.insertAction({
      workspaceId: discordWorkspace.id,
      sessionId: undefined,
      channelId: 'CHAN1',
      threadTs: 'MSG1',
      targetUserId: 'UOWNER',
      actionType: 'reply',
      disposition: 'queued',
      message: 'Approved legacy Discord reply',
      reason: 'Needs operator approval',
      confidence: 0.8
    });

    await gateway.handleReviewAction(item.id, { action: 'approve_send' });

    expect(postReply).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ provider: 'discord' }),
      expect.objectContaining({
        provider: 'discord',
        channelId: 'CHAN1',
        threadTs: 'MSG1',
        threadChannelId: 'MSG1'
      }),
      'Approved legacy Discord reply'
    );
    expect(postReply).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ provider: 'discord' }),
      expect.objectContaining({
        provider: 'discord',
        channelId: 'CHAN1',
        threadTs: 'MSG1',
        rootMessageId: 'MSG1'
      }),
      'Approved legacy Discord reply'
    );
  });

});
