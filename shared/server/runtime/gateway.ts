import { randomUUID } from 'node:crypto';
import { DEFAULT_HEARTBEAT_INTERVAL_MS } from '#shared/config';
import { AgentRuntime } from '#shared/server/runtime/agent-runtime';
import { emitControlPlaneEvent } from '#shared/server/runtime/control-plane';
import { nextDailyRun } from '#shared/server/util/cron';
import { getMemoryService } from '#shared/server/memory/service';
import { getMemoryIndexWorker } from '#shared/server/memory/index-worker';
import { ensureRuntimeInitialized } from '#shared/server/runtime/bootstrap';
import { getStore } from '#shared/server/persistence/store';
import { getToolRegistry } from '#shared/server/capabilities/tool-registry';
import { getRuntimeEnv } from '#shared/server/util/env';
import { evaluatePolicy } from '#shared/server/runtime/policy';
import { classifyPolicyExecution } from '#shared/server/runtime/policy-classifier';
import { outputSummary } from '#shared/server/runtime/tool-output';
import { refreshRuntimeState, withRuntimeRunLock } from '#shared/server/runtime/refresh';
import { resolveSubscriberPolicy } from '#shared/server/runtime/subscriber-policy';
import type {
  ActionContextSnapshot,
  AgentToolResult,
  AuditRecord,
  AutopilotSession,
  ChannelMessage,
  ChannelThreadRef,
  ContextAssembly,
  ContinuityTask,
  RecurringJobRecord,
  ReviewItem,
  RuntimeEventType,
  ThreadEvidenceStatus,
  Workspace,
  WorkspaceMemory
} from '#shared/types';

function failedToolNames(results: AgentToolResult[]): string[] {
  return results.filter((result) => !result.ok).map((result) => result.name);
}

function evidenceStatusFromToolResults(
  results: AgentToolResult[],
  artifacts: ContextAssembly['artifacts'] = []
): ThreadEvidenceStatus {
  const attemptedTools = [...new Set(results.map((result) => result.name))];
  const successfulByName = new Map<string, { name: string; summary?: Record<string, unknown> }>();
  const artifactEvidence = artifacts
    .filter((artifact) => artifact.source !== 'memory.linked_artifacts')
    .map((artifact) => ({
      name: artifact.source,
      summary: {
        type: artifact.type,
        title: artifact.title
      }
    }));
  for (const tool of [
    ...artifactEvidence,
    ...results
      .filter((result) => result.ok)
      .map((result) => ({
        name: result.name,
        summary: outputSummary(result.output)
      }))
  ]) {
    if (!successfulByName.has(tool.name)) {
      successfulByName.set(tool.name, tool);
    }
  }
  const successfulTools = [...successfulByName.values()];
  const failedTools = results
    .filter((result) => !result.ok)
    .map((result) => ({
      name: result.name,
      error: result.error
    }));

  return {
    status: successfulTools.length === 0 ? 'none' : failedTools.length === 0 ? 'complete' : 'partial',
    attemptedTools: attemptedTools.length > 0 ? attemptedTools : undefined,
    successfulTools,
    failedTools,
    updatedAt: new Date().toISOString()
  };
}

function shouldPersistThreadSummary(
  proposedAction: { type: string; confidence: number },
  evidenceStatus: ThreadEvidenceStatus
): boolean {
  return proposedAction.type === 'reply' && proposedAction.confidence >= 0.7 && evidenceStatus.status !== 'none';
}

function indexableArtifacts(artifacts: ContextAssembly['artifacts']): ContextAssembly['artifacts'] {
  return artifacts.filter((artifact) => !artifact.source.startsWith('memory.'));
}

function runtimeProviderName(): AuditRecord['provider'] {
  return getRuntimeEnv().defaultProvider;
}

function compactSnapshotText(text: string, limit = 1000): string {
  const compacted = text.replace(/\s+/g, ' ').trim();
  return compacted.length > limit ? `${compacted.slice(0, limit - 3)}...` : compacted;
}

function snapshotMessages(messages: ChannelMessage[]): ActionContextSnapshot['thread']['messages'] {
  return messages.slice(-50).map((message) => ({
    ts: message.ts,
    authorId: message.authorId ?? message.userId,
    text: compactSnapshotText(message.text)
  }));
}

function actionThreadSnapshot(thread: ChannelThreadRef, messages: ChannelMessage[]): ActionContextSnapshot['thread'] {
  return {
    provider: thread.provider,
    channelId: thread.channelId,
    threadTs: thread.threadTs,
    threadChannelId: thread.threadChannelId,
    rootMessageId: thread.rootMessageId,
    messages: snapshotMessages(messages)
  };
}

export class Gateway {
  private readonly agentRuntime = new AgentRuntime();
  private readonly memory = getMemoryService();
  private readonly memoryIndexWorker = getMemoryIndexWorker();
  private readonly store = getStore();
  private readonly tools = getToolRegistry();
  private heartbeatHandle: NodeJS.Timeout | null = null;

  ensureStarted(): void {
    if (this.heartbeatHandle) {
      return;
    }

    const { heartbeatIntervalMs } = getRuntimeEnv();
    this.heartbeatHandle = this.startHeartbeat(heartbeatIntervalMs);
    this.reconcileSessionExpirations();
  }

  startHeartbeat(intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS): NodeJS.Timeout {
    return setInterval(() => {
      void this.runHeartbeat();
    }, intervalMs);
  }

  async runHeartbeat(): Promise<void> {
    const nowIso = new Date().toISOString();
    const { runEventRetentionDays } = getRuntimeEnv();
    const cutoff = new Date(Date.now() - Math.max(1, runEventRetentionDays) * 24 * 60 * 60 * 1000).toISOString();
    this.store.pruneOldRunEvents(cutoff);
    this.expireDueSessions(nowIso);
    const reminders = this.store.listDueReminders(nowIso);

    for (const reminder of reminders) {
      if (!reminder.sessionId) {
        this.store.markReminderStatus(reminder.id, 'done');
        continue;
      }

      const session = this.store.getSessionById(reminder.sessionId);

      if (!session || session.status !== 'active') {
        this.store.markReminderStatus(reminder.id, 'done');
        continue;
      }

      const task: ContinuityTask = {
        id: randomUUID(),
        source: 'heartbeat',
        workspaceId: reminder.workspaceId,
        sessionId: reminder.sessionId,
        thread: {
          channelId: reminder.channelId,
          threadTs: reminder.threadTs
        },
        targetUserId: reminder.targetUserId,
        receivedAt: nowIso
      };

      await this.handleTask(task);
      this.store.markReminderStatus(reminder.id, 'done');
    }

    const recurringJobs = this.store.listDueRecurringJobs(nowIso);
    for (const job of recurringJobs) {
      await this.runRecurringJob(job);
      this.store.updateRecurringJobNextRun(job.id, nextDailyRun(job.localTime, job.timezone, new Date(nowIso)).toISOString());
    }
  }

  reconcileSessionExpirations(nowIso = new Date().toISOString()): void {
    this.expireDueSessions(nowIso);
  }

  private expireDueSessions(nowIso: string): AutopilotSession[] {
    const expired = this.store.expireDueSessions(nowIso);
    for (const session of expired) {
      emitControlPlaneEvent({ type: 'session.updated', session });
      emitControlPlaneEvent({ type: 'briefing.ready', sessionId: session.id });
    }
    return expired;
  }

  async runRecurringJob(job: RecurringJobRecord): Promise<void> {
    if (job.jobType !== 'morning_digest') {
      return;
    }

    const workspace = this.store.getWorkspaceById(job.workspaceId);
    const session = job.sessionId ? this.store.getSessionById(job.sessionId) : undefined;

    if (!workspace || !session || session.status !== 'active') {
      return;
    }

    if (!this.subscriptionAllowsChannel(workspace, job.payload.ownerUserId, job.payload.channelId)) {
      return;
    }

    const message = this.composeMorningDigest(session);
    const threadTs = `digest:${job.id}:${Date.now()}`;
    const run = this.store.createAgentRun({
      workspaceId: workspace.id,
      sessionId: session.id,
      taskId: `recurring:${job.id}:${Date.now()}`,
      channelId: job.payload.channelId,
      threadTs,
      targetUserId: job.payload.ownerUserId
    });
    emitControlPlaneEvent({ type: 'agent.run.updated', run });
    this.emitRunEvent(run.id, 'agent.run.started', { recurringJobId: job.id, jobType: job.jobType });
    this.emitRunEvent(run.id, 'agent.skill.selected', { skills: [] });
    this.emitRunEvent(run.id, 'agent.model.completed', {
      action: 'reply',
      reason: 'Scheduled morning digest',
      confidence: 1
    });
    const action = {
      workspaceId: workspace.id,
      sessionId: session.id,
      channelId: job.payload.channelId,
      threadTs,
      targetUserId: job.payload.ownerUserId,
      actionType: 'reply' as const,
      message,
      reason: 'Scheduled morning digest',
      confidence: 1,
      provider: runtimeProviderName(),
      contextSnapshot: {
        summary: 'Scheduled morning digest.',
        continuityCase: 'unknown' as const,
        thread: {
          provider: workspace.provider,
          channelId: job.payload.channelId,
          threadTs,
          messages: []
        }
      }
    };

    if (session.mode === 'auto_send_low_risk') {
      await this.tools.execute<{ channelId: string; text: string }, { ok: true; ts?: string }>(
        'channel.post_message',
        { channelId: job.payload.channelId, text: message },
        { workspace, session, workspaceMemory: this.memory.getWorkspaceMemory(workspace.id) }
      );
      const item = this.store.insertAction({ ...action, disposition: 'auto_sent' });
      this.emitRunEvent(run.id, 'agent.action.sent', { action: 'reply' });
      this.emitRunEvent(run.id, 'agent.run.completed', { executionResult: 'Posted morning digest.' });
      const completedRun = this.store.finishAgentRun(run.id, 'completed');
      if (completedRun) {
        emitControlPlaneEvent({ type: 'agent.run.updated', run: completedRun });
      }
      emitControlPlaneEvent({ type: 'queue.updated', item });
      return;
    }

    const item = this.store.insertAction({ ...action, disposition: 'queued' });
    this.emitRunEvent(run.id, 'agent.action.queued', { itemId: item.id, action: 'reply' });
    this.emitRunEvent(run.id, 'agent.run.completed', { executionResult: 'Queued morning digest for review.' });
    const completedRun = this.store.finishAgentRun(run.id, 'completed');
    if (completedRun) {
      emitControlPlaneEvent({ type: 'agent.run.updated', run: completedRun });
    }
    emitControlPlaneEvent({ type: 'queue.updated', item });
    emitControlPlaneEvent({ type: 'briefing.ready', sessionId: session.id });
  }

  private composeMorningDigest(session: AutopilotSession): string {
    const briefing = this.store.getMorningBriefing(session.id);
    const runs = this.store.listRunSummaries(session.id, 10);

    if (!briefing) {
      return `Morning digest for ${session.title}\n\nNo session activity was found.`;
    }

    const lines = [
      `Morning digest for ${session.title}`,
      '',
      `Handled: ${briefing.handledCount}`,
      `Queued: ${briefing.queuedCount}`,
      `Abstained: ${briefing.abstainedCount}`,
      `Failed: ${briefing.failedCount}`
    ];

    if (runs.length > 0) {
      lines.push('', 'Recent activity:');
      for (const run of runs.slice(0, 5)) {
        lines.push(`- ${run.run.channelId}/${run.run.threadTs}: ${run.executionResult || run.providerResponse || run.contextSummary}`);
      }
    }

    if (briefing.unresolvedItems.length > 0) {
      lines.push('', 'Queued review:');
      for (const item of briefing.unresolvedItems.slice(0, 5)) {
        lines.push(`- ${item.channelId}/${item.threadTs}: ${item.message || item.reason}`);
      }
    }

    return lines.join('\n');
  }

  private async buildActionContextSnapshot(input: {
    context: ContextAssembly;
    task: ContinuityTask;
    workspace: Workspace;
    session: AutopilotSession;
    workspaceMemory: WorkspaceMemory;
    evidenceStatus?: ThreadEvidenceStatus;
  }): Promise<ActionContextSnapshot> {
    let messages = input.context.thread.recentMessages;

    if (messages.length === 0) {
      try {
        messages = await this.tools.execute<{ channelId: string; threadTs: string }, ChannelMessage[]>(
          'channel.fetch_thread',
          input.task.thread,
          {
            workspace: input.workspace,
            session: input.session,
            task: input.task,
            workspaceMemory: input.workspaceMemory
          }
        );
      } catch {
        messages = [];
      }
    }

    return {
      summary: input.context.summary ?? input.context.thread.latestMessage,
      continuityCase: input.context.continuityCase,
      evidenceStatus: input.evidenceStatus,
      thread: actionThreadSnapshot(input.task.thread, messages)
    };
  }

  async handleTask(task: ContinuityTask): Promise<AuditRecord> {
    await ensureRuntimeInitialized();
    const workspace =
      (task.thread.provider ? this.store.getWorkspaceByExternalId(task.thread.provider, task.workspaceId) : undefined) ??
      this.store.getWorkspaceByExternalId('slack', task.workspaceId) ??
      this.store.getWorkspaceById(task.workspaceId) ??
      this.store.getFirstWorkspace();

    if (!workspace) {
      throw new Error('Workspace not found');
    }

    try {
      return await withRuntimeRunLock(workspace.id, async () => {
        await refreshRuntimeState({ reason: 'before_agent_run', workspaceIds: [workspace.id] });
        return await this.handleTaskForWorkspace(task, workspace);
      });
    } finally {
      await refreshRuntimeState({ reason: 'after_agent_run', workspaceIds: [workspace.id] }).catch((error) => {
        console.warn('[runtime] failed to drain pending refresh:', error instanceof Error ? error.message : error);
      });
    }
  }

  private async handleTaskForWorkspace(task: ContinuityTask, workspace: Workspace): Promise<AuditRecord> {
    const workspaceMemory = this.memory.getWorkspaceMemory(workspace.id);

    let session = this.resolveSession(task, workspace.id);
    let createdDirectSessionId: string | undefined;

    if (!session) {
      if (this.isPersonalDirectTask(task)) {
        session = await this.createPersonalDirectSession(workspace, task);
        createdDirectSessionId = session.id;
        emitControlPlaneEvent({ type: 'session.updated', session });
      } else {
        return this.recordAudit({
          task,
          workspaceId: workspace.id,
          sessionId: undefined,
          threadTs: task.thread.threadTs,
          action: 'abstain',
          disposition: 'abstained',
          policyReason: 'No active autopilot session matched this thread',
          modelReason: 'Session scope not active',
          confidence: 1
        });
      }
    }

    if (!this.isPersonalDirectTask(task) && !this.subscriptionAllowsTask(workspace, session, task)) {
      return this.recordAudit({
        task,
        workspaceId: workspace.id,
        sessionId: session.id,
        threadTs: task.thread.threadTs,
        action: 'abstain',
        disposition: 'abstained',
        policyReason: 'No active subscription matched this thread',
        modelReason: 'Subscription scope not active',
        confidence: 1
      });
    }

    const user =
      this.store.getUser(workspace.id, task.targetUserId);

    if (!user) {
      return this.recordAudit({
        task,
        workspaceId: workspace.id,
        sessionId: session.id,
        threadTs: task.thread.threadTs,
        action: 'abstain',
        disposition: 'abstained',
        policyReason: 'Target user schedule is not configured',
        modelReason: 'Unknown users do not receive default working hours',
        confidence: 1
      });
    }

    if (!this.isPersonalDirectTask(task) && task.actorUserId && task.actorUserId === session.ownerUserId) {
      return this.recordAudit({
        task,
        workspaceId: workspace.id,
        sessionId: session.id,
        threadTs: task.thread.threadTs,
        action: 'abstain',
        disposition: 'abstained',
        policyReason: 'Event actor is the session owner',
        modelReason: 'Owner is authoring this message themselves',
        confidence: 1
      });
    }

    const run = this.store.createAgentRun({
      workspaceId: workspace.id,
      sessionId: session.id,
      taskId: task.id,
      channelId: task.thread.channelId,
      threadTs: task.thread.threadTs,
      targetUserId: task.targetUserId
    });
    emitControlPlaneEvent({ type: 'agent.run.updated', run });
    this.emitRunEvent(run.id, 'agent.run.started', { task });

    let runResult;

    try {
      runResult = await this.agentRuntime.run(task, session, workspace);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent runtime failed';
      this.emitRunEvent(run.id, 'agent.run.failed', { error: message });
      const failedRun = this.store.finishAgentRun(run.id, 'failed');
      if (failedRun) {
        emitControlPlaneEvent({ type: 'agent.run.updated', run: failedRun });
      }
      this.stopCreatedDirectSession(createdDirectSessionId);
      throw error;
    }

    const evidenceStatus = evidenceStatusFromToolResults(runResult.toolResults, runResult.context.artifacts);
    const failedTools = failedToolNames(runResult.toolResults);
    const context: ContextAssembly = {
      ...runResult.context,
      memory: {
        ...runResult.context.memory,
        thread: {
          ...runResult.context.memory.thread,
          evidenceStatus
        }
      }
    };
    const proposedAction = runResult.proposedAction;
    this.emitRunEvent(run.id, 'agent.context.built', {
      summary: context.summary,
      artifacts: context.artifacts.length
    });
    this.emitRunEvent(run.id, 'agent.skill.selected', {
      skills: runResult.selectedSkillNames,
      availableTools: context.availableTools.map((tool) => tool.name),
      domainExpansion: runResult.domainExpansion
    });
    for (const event of runResult.runtimeEvents) {
      this.emitRunEvent(run.id, event.type, event.payload);
    }
    const policyExecution = await classifyPolicyExecution(context, session, proposedAction, evidenceStatus);
    this.emitRunEvent(run.id, 'agent.policy.decided', {
      phase: 'execution_classifier',
      ...policyExecution
    });
    const decision = evaluatePolicy(proposedAction, context, session, policyExecution);
    this.emitRunEvent(run.id, 'agent.policy.decided', decision);
    const finalAction = decision.downgradedTo ?? proposedAction.type;
    const toolsUsed = [
      'channel.fetch_thread',
      'user.get_preferences',
      'memory.workspace.read',
      'memory.thread.read',
      ...runResult.toolsUsed
    ];

    this.store.upsertThreadState({
      workspaceId: workspace.id,
      sessionId: session.id,
      channelId: task.thread.channelId,
      threadTs: task.thread.threadTs,
      targetUserId: task.targetUserId,
      lastMessageTs: context.thread.recentMessages.at(-1)?.ts ?? task.thread.threadTs,
      continuityCase: context.continuityCase,
      summary: context.summary,
      status: decision.execution === 'send' ? 'active' : decision.disposition,
      nextHeartbeatAt: proposedAction.followUpAt
    });

    const contextSnapshot = await this.buildActionContextSnapshot({
      context,
      task,
      workspace,
      session,
      workspaceMemory,
      evidenceStatus
    });
    const persistThreadSummary = shouldPersistThreadSummary(proposedAction, evidenceStatus);
    await this.tools.execute<
      {
        workspaceId: string;
        channelId: string;
        threadTs: string;
        targetUserId?: string;
        summary?: string;
        openQuestions?: string[];
        evidenceStatus?: ThreadEvidenceStatus;
      },
      ContextAssembly['memory']['thread']
    >(
      'memory.thread.write',
      {
        workspaceId: workspace.id,
        channelId: task.thread.channelId,
        threadTs: task.thread.threadTs,
        targetUserId: task.targetUserId,
        summary: persistThreadSummary ? context.summary : undefined,
        openQuestions: context.unresolvedQuestions,
        evidenceStatus
      },
      { workspace, session, task, workspaceMemory }
    );
    toolsUsed.push('memory.thread.write');
    if (persistThreadSummary) {
      this.emitRunEvent(run.id, 'agent.memory.written', {
        tools: ['memory.thread.write'],
        evidenceStatus: evidenceStatus.status,
        successfulTools: evidenceStatus.successfulTools.map((tool) => tool.name),
        failedTools
      });
    } else {
      this.emitRunEvent(run.id, 'agent.memory.skipped', {
        reason: evidenceStatus.status === 'none'
          ? 'No successful grounding tools were available for a durable factual summary.'
          : 'Only high-confidence replies are persisted as durable thread summaries.',
        failedTools,
        evidenceStatus: evidenceStatus.status,
        skipped: ['summary']
      });
    }

    let executionResult = 'No outbound action taken.';

    try {
      if (decision.execution === 'send' && proposedAction.message) {
        await this.tools.execute<ChannelThreadRef & { text: string }, { ok: true }>(
          'channel.post_reply',
          {
            ...task.thread,
            text: proposedAction.message
          },
          { workspace, session, task, workspaceMemory }
        );
        toolsUsed.push('channel.post_reply');
        executionResult = 'Posted channel reply automatically.';
        this.emitRunEvent(run.id, 'agent.action.sent', { action: finalAction });
      } else if (decision.execution === 'queue') {
        executionResult = 'Queued for operator review.';
      } else if (decision.execution === 'abstain') {
        executionResult = 'Recorded as abstain for briefing and audit.';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Slack action failed';

      this.store.insertAction({
        workspaceId: workspace.id,
        sessionId: session.id,
        channelId: task.thread.channelId,
        threadTs: task.thread.threadTs,
        targetUserId: task.targetUserId,
        actionType: 'abstain',
        disposition: 'failed',
        message: proposedAction.message,
        reason: message,
        confidence: proposedAction.confidence,
        provider: runtimeProviderName(),
        contextSnapshot
      });

      this.emitRunEvent(run.id, 'agent.run.failed', { error: message });
      const failedRun = this.store.finishAgentRun(run.id, 'failed');
      if (failedRun) {
        emitControlPlaneEvent({ type: 'agent.run.updated', run: failedRun });
      }
      emitControlPlaneEvent({ type: 'briefing.ready', sessionId: session.id });

      const audit = this.recordAudit({
        task,
        workspaceId: workspace.id,
        sessionId: session.id,
        threadTs: task.thread.threadTs,
        action: 'abstain',
        disposition: 'failed',
        policyReason: 'Action execution failed',
        modelReason: message,
        confidence: proposedAction.confidence,
        provider: runtimeProviderName()
      });
      emitControlPlaneEvent({ type: 'audit.created', audit });
      this.stopCreatedDirectSession(createdDirectSessionId);
      return audit;
    }

    const reviewItem: ReviewItem =
      decision.execution === 'queue'
        ? await this.tools.execute<
            {
              workspaceId: string;
              sessionId?: string;
              channelId: string;
              threadTs: string;
              targetUserId: string;
              actionType: ReviewItem['action'];
              disposition: 'queued';
              message: string;
              reason: string;
              confidence: number;
              provider?: AuditRecord['provider'];
              contextSnapshot?: ActionContextSnapshot;
            },
            ReviewItem
          >(
            'queue.enqueue',
            {
              workspaceId: workspace.id,
              sessionId: session.id,
              channelId: task.thread.channelId,
              threadTs: task.thread.threadTs,
              targetUserId: task.targetUserId,
              actionType: finalAction,
              disposition: 'queued',
              message: proposedAction.message,
              reason: proposedAction.reason,
              confidence: proposedAction.confidence,
              provider: runtimeProviderName(),
              contextSnapshot
            },
            { workspace, session, task, workspaceMemory }
          )
        : this.store.insertAction({
            workspaceId: workspace.id,
            sessionId: session.id,
            channelId: task.thread.channelId,
            threadTs: task.thread.threadTs,
            targetUserId: task.targetUserId,
            actionType: finalAction,
            disposition: decision.disposition,
            message: proposedAction.message,
            reason: proposedAction.reason,
            confidence: proposedAction.confidence,
            provider: runtimeProviderName(),
            contextSnapshot
          });
    if (decision.execution === 'queue') {
      toolsUsed.push('queue.enqueue');
      this.emitRunEvent(run.id, 'agent.action.queued', { itemId: reviewItem.id, action: finalAction });
    }
    emitControlPlaneEvent({ type: 'queue.updated', item: reviewItem });

    emitControlPlaneEvent({ type: 'briefing.ready', sessionId: session.id });
    const indexSource = this.memoryIndexSource(runResult.toolResults, context.artifacts);
    this.emitRunEvent(run.id, 'agent.memory.index_source', indexSource);
    this.emitRunEvent(run.id, 'agent.run.completed', { executionResult });
    const completedRun = this.store.finishAgentRun(run.id, 'completed');
    if (completedRun) {
      emitControlPlaneEvent({ type: 'agent.run.updated', run: completedRun });
    }
    this.queueMemoryIndex(run.id, indexSource);
    this.stopCreatedDirectSession(createdDirectSessionId);

    const audit = this.recordAudit({
      task,
      workspaceId: workspace.id,
      sessionId: session.id,
      threadTs: task.thread.threadTs,
      action: finalAction,
      disposition: decision.disposition,
      policyReason: decision.reason,
      modelReason: proposedAction.reason,
      confidence: proposedAction.confidence,
      provider: runtimeProviderName()
    });
    emitControlPlaneEvent({ type: 'audit.created', audit });
    return audit;
  }

  private resolveSession(task: ContinuityTask, workspaceId: string): AutopilotSession | undefined {
    const explicit = task.sessionId ? this.store.getSessionById(task.sessionId) : undefined;

    if (
      explicit?.status === 'active' &&
      explicit.workspaceId === workspaceId &&
      explicit.ownerUserId === task.targetUserId &&
      explicit.endsAt > new Date().toISOString()
    ) {
      return explicit;
    }

    const session = this.store.findMatchingSession(workspaceId, task.targetUserId, task.thread.channelId);

    if (session?.endsAt && session.endsAt <= new Date().toISOString()) {
      this.store.stopSession(session.id, 'expired');
      return undefined;
    }

    return session;
  }

  private isPersonalDirectTask(task: ContinuityTask): boolean {
    return task.conversationKind === 'direct';
  }

  private async createPersonalDirectSession(workspace: Workspace, task: ContinuityTask): Promise<AutopilotSession> {
    const existingUser = this.store.getUser(workspace.id, task.targetUserId);
    if (!existingUser) {
      this.store.upsertUser({
        workspaceId: workspace.id,
        externalUserId: task.targetUserId,
        displayName: task.targetUserId
      });
    }

    const policy = await resolveSubscriberPolicy({
      workspaceId: workspace.id,
      ownerUserId: task.targetUserId
    });

    return this.store.createSession({
      workspaceId: workspace.id,
      ownerUserId: task.targetUserId,
      title: 'Personal request',
      mode: policy.mode,
      channelScope: [task.thread.channelId],
      policyProfileName: policy.userPolicy.profileName,
      policyOverrideRaw: policy.userPolicy.overrideRaw,
      policy: policy.userPolicy,
      policyBinding: 'config',
      channelScopeBinding: 'explicit',
      endsAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });
  }

  private stopCreatedDirectSession(sessionId: string | undefined): void {
    if (!sessionId) return;
    this.store.stopSession(sessionId, 'stopped');
    const session = this.store.getSessionById(sessionId);
    if (session) {
      emitControlPlaneEvent({ type: 'session.updated', session });
    }
  }

  private subscriptionAllowsTask(workspace: Workspace, session: AutopilotSession, task: ContinuityTask): boolean {
    return this.subscriptionAllowsChannel(workspace, session.ownerUserId, task.thread.channelId);
  }

  private subscriptionAllowsChannel(workspace: Workspace, ownerUserId: string, channelId: string): boolean {
    const subscription = this.store.getWorkspaceSubscription(workspace.id, ownerUserId);
    return Boolean(
      subscription?.status === 'active' &&
      this.store.subscriptionAllowsChannelScope(subscription, [channelId])
    );
  }

  private reviewThreadRef(item: ReviewItem, workspace: Workspace): ChannelThreadRef {
    const snapshotThread = item.contextSnapshot?.thread;
    return {
      provider: snapshotThread?.provider ?? workspace.provider,
      channelId: snapshotThread?.channelId ?? item.channelId,
      threadTs: snapshotThread?.threadTs ?? item.threadTs,
      threadChannelId: snapshotThread?.threadChannelId,
      rootMessageId: snapshotThread?.rootMessageId
    };
  }

  private async postReviewReply(
    item: ReviewItem,
    workspace: Workspace,
    session: AutopilotSession | undefined,
    workspaceMemory: WorkspaceMemory,
    text: string
  ): Promise<void> {
    const thread = this.reviewThreadRef(item, workspace);
    const isLegacyDiscordThread =
      workspace.provider === 'discord' &&
      thread.provider === 'discord' &&
      !thread.threadChannelId &&
      !thread.rootMessageId;

    if (!isLegacyDiscordThread) {
      await this.tools.execute<ChannelThreadRef & { text: string }, { ok: true }>(
        'channel.post_reply',
        { ...thread, text },
        { workspace, session, workspaceMemory }
      );
      return;
    }

    try {
      await this.tools.execute<ChannelThreadRef & { text: string }, { ok: true }>(
        'channel.post_reply',
        { ...thread, threadChannelId: item.threadTs, text },
        { workspace, session, workspaceMemory }
      );
    } catch {
      await this.tools.execute<ChannelThreadRef & { text: string }, { ok: true }>(
        'channel.post_reply',
        { ...thread, rootMessageId: item.threadTs, text },
        { workspace, session, workspaceMemory }
      );
    }
  }

  async handleReviewAction(
    itemId: string,
    input: {
      action: 'approve_send' | 'edit_send' | 'reject' | 'mark_abstain';
      message?: string;
      reason?: string;
    }
  ): Promise<ReviewItem> {
    await ensureRuntimeInitialized();
    const item = this.store.getReviewItem(itemId);

    if (!item) {
      throw new Error('Review item not found');
    }

    const workspace = this.store.getWorkspaceById(item.workspaceId);

    if (!workspace) {
      throw new Error('Workspace not found for review item');
    }

    const workspaceMemory = this.memory.getWorkspaceMemory(workspace.id);
    const session = item.sessionId ? this.store.getSessionById(item.sessionId) : undefined;
    const nextMessage = input.message?.trim() || item.message;
    const nextReason = input.reason?.trim() || item.reason;

    if (input.action === 'approve_send' || input.action === 'edit_send') {
      const isDigest = item.threadTs.startsWith('digest:');
      if (isDigest) {
        await this.tools.execute<{ channelId: string; text: string }, { ok: true }>(
          'channel.post_message',
          {
            channelId: item.channelId,
            text: nextMessage
          },
          { workspace, session, workspaceMemory }
        );
      } else {
        await this.postReviewReply(item, workspace, session, workspaceMemory, nextMessage);
      }

      const updated = await this.tools.execute<
        {
          id: string;
          disposition: 'auto_sent';
          message: string;
          reason: string;
          action: ReviewItem['action'];
        },
        ReviewItem | undefined
      >(
        'queue.update',
        {
          id: item.id,
          disposition: 'auto_sent',
          message: nextMessage,
          reason: nextReason,
          action: item.action
        },
        { workspace, session, workspaceMemory }
      );

      if (!updated) {
        throw new Error('Failed to update review item');
      }

      emitControlPlaneEvent({ type: 'queue.updated', item: updated });
      if (item.sessionId) {
        emitControlPlaneEvent({ type: 'briefing.ready', sessionId: item.sessionId });
      }
      const audit = this.recordAudit({
        task: {
          id: `review:${item.id}`,
          source: 'review_queue',
          workspaceId: workspace.id,
          sessionId: item.sessionId,
          thread: this.reviewThreadRef(item, workspace),
          targetUserId: item.targetUserId ?? session?.ownerUserId ?? 'unknown',
          receivedAt: new Date().toISOString()
        },
        workspaceId: workspace.id,
        sessionId: item.sessionId,
        threadTs: item.threadTs,
        action: item.action,
        disposition: 'auto_sent',
        policyReason: 'Operator approved queued action',
        modelReason: nextReason,
        confidence: item.confidence ?? 1,
        provider: item.provider
      });
      emitControlPlaneEvent({ type: 'audit.created', audit });
      return updated;
    }

    const finalAction = input.action === 'mark_abstain' ? 'abstain' : item.action;
    const finalDisposition = input.action === 'mark_abstain' ? 'abstained' : 'failed';
    const updated = await this.tools.execute<
      {
        id: string;
        disposition: 'abstained' | 'failed';
        message: string;
        reason: string;
        action: ReviewItem['action'];
      },
      ReviewItem | undefined
    >(
      'queue.update',
      {
        id: item.id,
        disposition: finalDisposition,
        message: nextMessage,
        reason: nextReason,
        action: finalAction
      },
      { workspace, session, workspaceMemory }
    );

    if (!updated) {
      throw new Error('Failed to update review item');
    }

    emitControlPlaneEvent({ type: 'queue.updated', item: updated });
    if (item.sessionId) {
      emitControlPlaneEvent({ type: 'briefing.ready', sessionId: item.sessionId });
    }
    const audit = this.recordAudit({
      task: {
        id: `review:${item.id}`,
        source: 'review_queue',
        workspaceId: workspace.id,
        sessionId: item.sessionId,
        thread: this.reviewThreadRef(item, workspace),
        targetUserId: item.targetUserId ?? session?.ownerUserId ?? 'unknown',
        receivedAt: new Date().toISOString()
      },
      workspaceId: workspace.id,
      sessionId: item.sessionId,
      threadTs: item.threadTs,
      action: finalAction,
      disposition: finalDisposition,
      policyReason: 'Operator resolved queued action without send',
      modelReason: nextReason,
      confidence: item.confidence ?? 1,
      provider: item.provider
    });
    emitControlPlaneEvent({ type: 'audit.created', audit });
    return updated;
  }

  private emitRunEvent(runId: string, type: RuntimeEventType, payload: unknown): void {
    const event = this.store.appendAgentRunEvent({ runId, type, payload });
    emitControlPlaneEvent({ type: 'agent.run.event', event });
  }

  private memoryIndexSource(toolResults: AgentToolResult[], artifacts: ContextAssembly['artifacts']): {
    toolResults: AgentToolResult[];
    artifacts: ContextAssembly['artifacts'];
  } {
    const readToolNames = new Set(this.tools.list()
      .filter((tool) => tool.sideEffectClass === 'read' && !tool.name.startsWith('memory.'))
      .map((tool) => tool.name));
    return {
      toolResults: toolResults.filter((result) => result.ok && readToolNames.has(result.name)),
      artifacts: indexableArtifacts(artifacts)
    };
  }

  private queueMemoryIndex(runId: string, source: { toolResults: AgentToolResult[]; artifacts: ContextAssembly['artifacts'] }): void {
    if (source.toolResults.length === 0 && source.artifacts.length === 0) {
      return;
    }
    this.emitRunEvent(runId, 'agent.memory.index_queued', {
      toolResults: source.toolResults.length,
      artifacts: source.artifacts.length
    });
    this.memoryIndexWorker.enqueue(runId);
  }

  private recordAudit(
    input: Omit<AuditRecord, 'id' | 'createdAt' | 'taskId'> & { task: ContinuityTask }
  ): AuditRecord {
    const audit: AuditRecord = {
      id: randomUUID(),
      taskId: input.task.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      threadTs: input.threadTs,
      action: input.action,
      disposition: input.disposition,
      policyReason: input.policyReason,
      modelReason: input.modelReason,
      confidence: input.confidence,
      provider: input.provider,
      createdAt: new Date().toISOString()
    };

    this.store.insertAudit(audit);
    return audit;
  }
}

let gateway: Gateway | null = null;

export function getGateway(): Gateway {
  if (!gateway) {
    gateway = new Gateway();
  }

  return gateway;
}
