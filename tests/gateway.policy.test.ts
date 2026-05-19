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
    name: 'channel-continuity',
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
    selectedSkillNames: ['channel-continuity'],
    toolsUsed: [],
    toolResults: overrides.toolResults ?? [],
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
  } = {}
) {
  vi.resetModules();
  process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-gateway-policy-')), 'murph.sqlite');
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

  vi.doMock('#lib/server/capabilities/channel-registry', () => ({
    getChannelRegistry: () => ({
      register: vi.fn(),
      fetchThread,
      postReply: vi.fn(),
      postMessage: vi.fn()
    })
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

  return { store, gateway: getGateway(), workspace, runSpy };
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

});
