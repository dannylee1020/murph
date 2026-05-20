import { randomUUID } from 'node:crypto';
import { DEFAULT_HEARTBEAT_INTERVAL_MS } from '#lib/config';
import { AgentRuntime } from '#lib/server/runtime/agent-runtime';
import { emitControlPlaneEvent } from '#lib/server/runtime/control-plane';
import { nextDailyRun } from '#lib/server/util/cron';
import { getMemoryService } from '#lib/server/memory/service';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import { getStore } from '#lib/server/persistence/store';
import { getToolRegistry } from '#lib/server/capabilities/tool-registry';
import { getRuntimeEnv } from '#lib/server/util/env';
import { evaluatePolicy } from '#lib/server/runtime/policy';
import { classifyPolicyExecution } from '#lib/server/runtime/policy-classifier';
import { outputSummary } from '#lib/server/runtime/tool-output';
import type {
  ActionContextSnapshot,
  AgentToolResult,
  AuditRecord,
  AutopilotSession,
  ChannelMessage,
  ContextAssembly,
  ContinuityTask,
  RecurringJobRecord,
  ReviewItem,
  RuntimeEventType,
  ThreadEvidenceStatus,
  Workspace,
  WorkspaceMemory
} from '#lib/types';

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

export class Gateway {
  private readonly agentRuntime = new AgentRuntime();
  private readonly memory = getMemoryService();
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
    this.emitRunEvent(run.id, 'agent.skill.selected', { skills: ['morning-digest'] });
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
      provider: this.store.getProviderSettings(workspace.id)?.provider,
      contextSnapshot: {
        summary: 'Scheduled morning digest.',
        continuityCase: 'unknown' as const,
        thread: {
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
          {
            channelId: input.task.thread.channelId,
            threadTs: input.task.thread.threadTs
          },
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
      thread: {
        channelId: input.task.thread.channelId,
        threadTs: input.task.thread.threadTs,
        messages: snapshotMessages(messages)
      }
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

    const workspaceMemory = this.memory.getWorkspaceMemory(workspace.id);

    const session = this.resolveSession(task, workspace.id);

    if (!session) {
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

    if (task.actorUserId && task.actorUserId === session.ownerUserId) {
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
    const threadMemory = await this.tools.execute<
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
      await this.tools.execute<{ context: typeof context }, unknown>(
        'memory.thread.write_markdown',
        { context: { ...context, memory: { ...context.memory, thread: threadMemory } } },
        { workspace, session, task, workspaceMemory }
      );
      toolsUsed.push('memory.thread.write_markdown');
      this.emitRunEvent(run.id, 'agent.memory.written', {
        tools: ['memory.thread.write', 'memory.thread.write_markdown'],
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
        skipped: ['summary', 'markdown']
      });
    }

    let executionResult = 'No outbound action taken.';

    try {
      if (decision.execution === 'send' && proposedAction.message) {
        await this.tools.execute<{ channelId: string; threadTs: string; text: string }, { ok: true }>(
          'channel.post_reply',
          {
            channelId: task.thread.channelId,
            threadTs: task.thread.threadTs,
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
        provider: this.store.getProviderSettings(workspace.id)?.provider,
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
        provider: this.store.getProviderSettings(workspace.id)?.provider
      });
      emitControlPlaneEvent({ type: 'audit.created', audit });
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
              provider: this.store.getProviderSettings(workspace.id)?.provider,
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
            provider: this.store.getProviderSettings(workspace.id)?.provider,
            contextSnapshot
          });
    if (decision.execution === 'queue') {
      toolsUsed.push('queue.enqueue');
      this.emitRunEvent(run.id, 'agent.action.queued', { itemId: reviewItem.id, action: finalAction });
    }
    emitControlPlaneEvent({ type: 'queue.updated', item: reviewItem });

    emitControlPlaneEvent({ type: 'briefing.ready', sessionId: session.id });
    this.emitRunEvent(run.id, 'agent.run.completed', { executionResult });
    const completedRun = this.store.finishAgentRun(run.id, 'completed');
    if (completedRun) {
      emitControlPlaneEvent({ type: 'agent.run.updated', run: completedRun });
    }

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
      provider: this.store.getProviderSettings(workspace.id)?.provider
    });
    emitControlPlaneEvent({ type: 'audit.created', audit });
    return audit;
  }

  private resolveSession(task: ContinuityTask, workspaceId: string): AutopilotSession | undefined {
    const explicit = task.sessionId ? this.store.getSessionById(task.sessionId) : undefined;

    if (explicit?.status === 'active' && explicit.endsAt > new Date().toISOString()) {
      return explicit;
    }

    const session = this.store.findMatchingSession(workspaceId, task.targetUserId, task.thread.channelId);

    if (session?.endsAt && session.endsAt <= new Date().toISOString()) {
      this.store.stopSession(session.id, 'expired');
      return undefined;
    }

    return session;
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
        await this.tools.execute<{ channelId: string; threadTs: string; text: string }, { ok: true }>(
          'channel.post_reply',
          {
            channelId: item.channelId,
            threadTs: item.threadTs,
            text: nextMessage
          },
          { workspace, session, workspaceMemory }
        );
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
          thread: { channelId: item.channelId, threadTs: item.threadTs },
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
        thread: { channelId: item.channelId, threadTs: item.threadTs },
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
