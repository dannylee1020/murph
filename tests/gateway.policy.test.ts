import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentToolResult, ContextAssembly, ContinuityTask, SkillManifest } from '../shared/types';
import type { AgentRunResult } from '../shared/server/runtime/agent-runtime';

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
    subscribeOwner?: boolean;
  } = {}
) {
  vi.resetModules();
  const testRoot = mkdtempSync(join(tmpdir(), 'murph-gateway-policy-'));
  process.env.MURPH_HOME = testRoot;
  process.env.MURPH_CONFIG_PATH = join(testRoot, 'config.yaml');
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

  vi.doMock('#shared/server/capabilities/channel-registry', () => ({
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

  vi.doMock('#shared/server/runtime/policy-classifier', () => ({
    classifyPolicyExecution
  }));

  const { getStore } = await import('#shared/server/persistence/store');
  const { getGateway } = await import('#shared/server/runtime/gateway');
  const { AgentRuntime } = await import('#shared/server/runtime/agent-runtime');
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
  if (overrides.subscribeOwner !== false) {
    store.upsertWorkspaceSubscription({
      workspaceId: workspace.id,
      provider: 'slack',
      externalUserId: 'UOWNER',
      displayName: 'Owner',
      status: 'active',
      channelScopeMode: 'selected',
      channelScope: ['C1']
    });
  }
  const session = store.createSession({
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

  return { store, gateway: getGateway(), workspace, session, runSpy, classifyPolicyExecution, postReply, postMessage };
}

describe('Gateway session-first policy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.MURPH_HOME;
    delete process.env.MURPH_CONFIG_PATH;
    delete process.env.MURPH_SQLITE_PATH;
    delete process.env.MURPH_MEMORY_PATH;
    delete process.env.MURPH_ENCRYPTION_KEY;
  });

  it('writes thread memory for clean runs', async () => {
    const { gateway, store, workspace } = await setup();

    await gateway.handleTask(task());

    const memory = store.getOrCreateThreadMemory(workspace.id, 'C1', '111.222', 'UOWNER');
    expect(memory.summary).toBe('Owner was asked to confirm status.');
    expect(memory.evidenceStatus?.status).toBe('complete');
    expect(memory.evidenceStatus?.attemptedTools).toEqual(['channel.fetch_thread']);
    expect(store.getThreadMemory(workspace.id, 'C1', '111.222', 'UOTHER')).toBeUndefined();
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

    const memory = store.getOrCreateThreadMemory(workspace.id, 'C1', '111.222', 'UOWNER');
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

    const memory = store.getOrCreateThreadMemory(workspace.id, 'C1', '111.222', 'UOWNER');
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

    const memory = store.getOrCreateThreadMemory(workspace.id, 'C1', '111.222', 'UOWNER');
    expect(memory.summary).toBeUndefined();
    expect(memory.openQuestions).toEqual(['What time window should be checked?']);
    const runs = store.listAgentRuns(undefined, 1);
    const events = store.listAgentRunEvents(runs[0].id);
    expect(events.some((event) => event.type === 'agent.memory.skipped')).toBe(true);
  });

  it('does not run recurring subscriber jobs for paused subscriptions', async () => {
    const { gateway, store, workspace, session, postMessage } = await setup({
      sessionMode: 'auto_send_low_risk'
    });
    store.upsertWorkspaceSubscription({
      workspaceId: workspace.id,
      provider: 'slack',
      externalUserId: 'UOWNER',
      displayName: 'Owner',
      status: 'paused',
      channelScopeMode: 'selected',
      channelScope: ['C1']
    });
    const job = store.createRecurringJob({
      workspaceId: workspace.id,
      sessionId: session.id,
      jobType: 'morning_digest',
      localTime: '08:30',
      timezone: 'America/Los_Angeles',
      payload: { channelId: 'C1', ownerUserId: 'UOWNER' },
      nextRunAt: new Date().toISOString()
    });

    await gateway.runRecurringJob(job);

    expect(postMessage).not.toHaveBeenCalled();
    expect(store.listAgentRuns(session.id, 10)).toEqual([]);
  });

  it('does not run recurring subscriber jobs without a subscription', async () => {
    const { gateway, store, workspace, session, postMessage } = await setup({
      sessionMode: 'auto_send_low_risk',
      subscribeOwner: false
    });
    const job = store.createRecurringJob({
      workspaceId: workspace.id,
      sessionId: session.id,
      jobType: 'morning_digest',
      localTime: '08:30',
      timezone: 'America/Los_Angeles',
      payload: { channelId: 'C1', ownerUserId: 'UOWNER' },
      nextRunAt: new Date().toISOString()
    });

    await gateway.runRecurringJob(job);

    expect(postMessage).not.toHaveBeenCalled();
    expect(store.listAgentRuns(session.id, 10)).toEqual([]);
  });

  it('abstains when the event actor is the session owner', async () => {
    const { gateway, runSpy } = await setup();

    const audit = await gateway.handleTask(task({ actorUserId: 'UOWNER' }));

    expect(runSpy).not.toHaveBeenCalled();
    expect(audit.disposition).toBe('abstained');
    expect(audit.policyReason).toBe('Event actor is the session owner');
  });

  it('abstains before the agent when the session owner has no subscription', async () => {
    const { gateway, runSpy } = await setup({ subscribeOwner: false });

    const audit = await gateway.handleTask(task());

    expect(runSpy).not.toHaveBeenCalled();
    expect(audit.disposition).toBe('abstained');
    expect(audit.policyReason).toBe('No active subscription matched this thread');
  });

  it('abstains before the agent when the subscription excludes the channel', async () => {
    const { gateway, store, workspace, runSpy } = await setup();
    store.upsertWorkspaceSubscription({
      workspaceId: workspace.id,
      provider: 'slack',
      externalUserId: 'UOWNER',
      displayName: 'Owner',
      status: 'active',
      channelScopeMode: 'selected',
      channelScope: ['C2']
    });

    const audit = await gateway.handleTask(task());

    expect(runSpy).not.toHaveBeenCalled();
    expect(audit.disposition).toBe('abstained');
    expect(audit.policyReason).toBe('No active subscription matched this thread');
  });

  it('does not let explicit session ids bypass subscription scope', async () => {
    const { gateway, store, workspace, session, runSpy } = await setup();
    store.upsertWorkspaceSubscription({
      workspaceId: workspace.id,
      provider: 'slack',
      externalUserId: 'UOWNER',
      displayName: 'Owner',
      status: 'active',
      channelScopeMode: 'selected',
      channelScope: ['C2']
    });

    const audit = await gateway.handleTask(task({ sessionId: session.id }));

    expect(runSpy).not.toHaveBeenCalled();
    expect(audit.disposition).toBe('abstained');
    expect(audit.policyReason).toBe('No active subscription matched this thread');
  });

  it('creates personal direct sessions with the represented owner subscriber policy', async () => {
    const { gateway, store, workspace, runSpy } = await setup();
    const { updateMurphPolicyConfig } = await import('../shared/server/setup/config-file');
    updateMurphPolicyConfig({ profileName: 'yolo', mode: 'auto_send_low_risk' });
    store.upsertWorkspaceSubscription({
      workspaceId: workspace.id,
      provider: 'slack',
      externalUserId: 'UOWNER',
      displayName: 'Owner',
      status: 'active',
      channelScopeMode: 'all_accessible',
      channelScope: [],
      policyProfileName: 'yolo',
      policyMode: 'auto_send_low_risk'
    });

    await gateway.handleTask(task({
      conversationKind: 'direct',
      thread: { provider: 'slack', channelId: 'D1', threadTs: 'D1' }
    }));

    expect(runSpy).toHaveBeenCalledOnce();
    const session = runSpy.mock.calls[0][1];
    expect(session.mode).toBe('auto_send_low_risk');
    expect(session.policyProfileName).toBe('yolo');
    expect(session.policy?.compiled.allowAutoSend).toBe(true);
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

  it('shows policy queue and operator approval in triage lifecycle', async () => {
    const { gateway, store, workspace } = await setup({
      policyExecution: {
        execution: 'queue',
        reason: 'Request is policy-sensitive and needs operator review.',
        confidence: 0.7
      }
    });

    await gateway.handleTask(task());
    const queued = store.listReviewQueue(workspace.id)[0];

    await gateway.handleReviewAction(queued.id, { action: 'approve_send' });

    const triageItems = store.listTriageItems(workspace.id, queued.sessionId);
    expect(triageItems[0]).toEqual(expect.objectContaining({
      id: queued.id,
      disposition: 'auto_sent'
    }));
    expect(triageItems[0].lifecycle).toEqual([
      expect.objectContaining({
        disposition: 'queued',
        label: 'Queued by policy',
        source: 'policy',
        reason: 'Policy manual-review mode queues actions by default'
      }),
      expect.objectContaining({
        disposition: 'auto_sent',
        label: 'Approved and sent by operator',
        source: 'operator',
        reason: 'Operator approved queued action'
      })
    ]);
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

  it('approves queued personal replies with the personal bot installation', async () => {
    const { gateway, store, workspace, postReply } = await setup();
    const installation = store.upsertBotInstallation({
      workspaceId: workspace.id,
      provider: 'slack',
      role: 'personal',
      externalWorkspaceId: workspace.externalWorkspaceId,
      botUserId: 'UPERSONALBOT',
      representedUserId: 'UOWNER'
    });
    const item = store.insertAction({
      workspaceId: workspace.id,
      sessionId: undefined,
      channelId: 'DOWNER',
      threadTs: '1710000000.000100',
      targetUserId: 'UOWNER',
      actionType: 'reply',
      disposition: 'queued',
      message: 'Approved personal reply',
      reason: 'Needs operator approval',
      confidence: 0.8,
      contextSnapshot: {
        summary: 'Personal DM summary',
        continuityCase: 'clarification',
        thread: {
          provider: 'slack',
          botRole: 'personal',
          botInstallationId: installation.id,
          channelId: 'DOWNER',
          threadTs: '1710000000.000100',
          messages: []
        }
      }
    });

    await gateway.handleReviewAction(item.id, { action: 'approve_send' });

    expect(postReply).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'slack' }),
      expect.objectContaining({
        provider: 'slack',
        botRole: 'personal',
        botInstallationId: installation.id,
        channelId: 'DOWNER',
        threadTs: '1710000000.000100'
      }),
      'Approved personal reply'
    );
  });

  it('infers personal bot metadata for older queued Slack DM replies', async () => {
    const { gateway, store, workspace, postReply } = await setup();
    const installation = store.upsertBotInstallation({
      workspaceId: workspace.id,
      provider: 'slack',
      role: 'personal',
      externalWorkspaceId: workspace.externalWorkspaceId,
      botUserId: 'UPERSONALBOT',
      representedUserId: 'UOWNER'
    });
    const item = store.insertAction({
      workspaceId: workspace.id,
      sessionId: undefined,
      channelId: 'DOWNER',
      threadTs: '1710000000.000200',
      targetUserId: 'UOWNER',
      actionType: 'reply',
      disposition: 'queued',
      message: 'Approved older personal reply',
      reason: 'Needs operator approval',
      confidence: 0.8
    });

    await gateway.handleReviewAction(item.id, { action: 'approve_send' });

    expect(postReply).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'slack' }),
      expect.objectContaining({
        provider: 'slack',
        botRole: 'personal',
        botInstallationId: installation.id,
        channelId: 'DOWNER',
        threadTs: '1710000000.000200'
      }),
      'Approved older personal reply'
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
