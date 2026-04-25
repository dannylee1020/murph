import { getDb } from '#lib/server/persistence/db';
import type {
  ActionDisposition,
  AgentRunEventRecord,
  AgentRunRecord,
  AgentRunStatus,
  AgentRunSummary,
  AgentUser,
  AuditRecord,
  AutopilotSession,
  ContinuityActionType,
  FeedbackRecord,
  MorningBriefing,
  ProviderSettings,
  RecurringJobRecord,
  ReminderRecord,
  ReviewItem,
  SessionStatus,
  ThreadMemory,
  ThreadStateRecord,
  UserMemory,
  Workspace,
  WorkspaceMemory,
  WorkspaceSummary
} from '#lib/types';
import * as action from './stores/action.js';
import * as audit from './stores/audit.js';
import * as briefing from './stores/briefing.js';
import * as memory from './stores/memory.js';
import * as providerSettings from './stores/provider-settings.js';
import * as recurringJob from './stores/recurring-job.js';
import * as reminder from './stores/reminder.js';
import * as run from './stores/run.js';
import * as session from './stores/session.js';
import * as threadState from './stores/thread-state.js';
import * as user from './stores/user.js';
import * as workspace from './stores/workspace.js';

export class Store {
  private readonly db = getDb();

  // Workspace + slack events
  saveInstall(input: workspace.InstallInput): Workspace {
    return workspace.saveInstall(this.db, input);
  }
  getWorkspaceByTeamId(slackTeamId: string): Workspace | undefined {
    return workspace.getWorkspaceByTeamId(this.db, slackTeamId);
  }
  getWorkspaceById(id: string): Workspace | undefined {
    return workspace.getWorkspaceById(this.db, id);
  }
  getFirstWorkspace(): Workspace | undefined {
    return workspace.getFirstWorkspace(this.db);
  }
  saveSlackEvent(input: workspace.SlackEventInput): boolean {
    return workspace.saveSlackEvent(this.db, input);
  }

  // User
  upsertUser(input: user.UpsertUserInput): AgentUser {
    return user.upsertUser(this.db, input);
  }
  getUser(workspaceId: string, slackUserId: string): AgentUser | undefined {
    return user.getUser(this.db, workspaceId, slackUserId);
  }
  listUsers(workspaceId?: string): AgentUser[] {
    return user.listUsers(this.db, workspaceId);
  }

  // Memory (user/workspace/thread/feedback)
  getOrCreateUserMemory(workspaceId: string, slackUserId: string): UserMemory {
    return memory.getOrCreateUserMemory(this.db, workspaceId, slackUserId);
  }
  upsertUserMemory(workspaceId: string, slackUserId: string, next: UserMemory): void {
    memory.upsertUserMemory(this.db, workspaceId, slackUserId, next);
  }
  getOrCreateWorkspaceMemory(workspaceId: string): WorkspaceMemory {
    return memory.getOrCreateWorkspaceMemory(this.db, workspaceId);
  }
  upsertWorkspaceMemory(next: WorkspaceMemory): void {
    memory.upsertWorkspaceMemory(this.db, next);
  }
  getOrCreateThreadMemory(workspaceId: string, channelId: string, threadTs: string): ThreadMemory {
    return memory.getOrCreateThreadMemory(this.db, workspaceId, channelId, threadTs);
  }
  upsertThreadMemory(next: ThreadMemory): void {
    memory.upsertThreadMemory(this.db, next);
  }
  insertFeedback(input: Omit<FeedbackRecord, 'id' | 'createdAt'>): FeedbackRecord {
    return memory.insertFeedback(this.db, input);
  }

  // Session
  createSession(input: session.SessionInput): AutopilotSession {
    return session.createSession(this.db, input);
  }
  getSessionById(id: string): AutopilotSession | undefined {
    return session.getSessionById(this.db, id);
  }
  listActiveSessions(workspaceId?: string): AutopilotSession[] {
    return session.listActiveSessions(this.db, workspaceId);
  }
  stopSession(id: string, status: SessionStatus = 'stopped'): void {
    session.stopSession(this.db, id, status);
  }
  expireDueSessions(nowIso: string): void {
    session.expireDueSessions(this.db, nowIso);
  }
  findMatchingSession(
    workspaceId: string,
    ownerSlackUserId: string,
    channelId: string
  ): AutopilotSession | undefined {
    return session.findMatchingSession(this.db, workspaceId, ownerSlackUserId, channelId);
  }

  // Thread state
  getThreadState(workspaceId: string, channelId: string, threadTs: string): ThreadStateRecord | undefined {
    return threadState.getThreadState(this.db, workspaceId, channelId, threadTs);
  }
  upsertThreadState(input: threadState.ThreadStateInput): void {
    threadState.upsertThreadState(this.db, input);
  }

  // Action / review queue
  insertAction(input: action.ActionInput): ReviewItem {
    return action.insertAction(this.db, input);
  }
  getReviewItem(id: string): ReviewItem | undefined {
    return action.getReviewItem(this.db, id);
  }
  updateReviewItem(
    id: string,
    input: {
      disposition?: ActionDisposition;
      message?: string;
      reason?: string;
      action?: ContinuityActionType;
    }
  ): ReviewItem | undefined {
    return action.updateReviewItem(this.db, id, input);
  }
  listReviewQueue(workspaceId?: string, sessionId?: string): ReviewItem[] {
    return action.listReviewQueue(this.db, workspaceId, sessionId);
  }

  // Audit
  insertAudit(input: AuditRecord): void {
    audit.insertAudit(this.db, input);
  }
  listAudit(workspaceId?: string, limit = 50): AuditRecord[] {
    return audit.listAudit(this.db, workspaceId, limit);
  }

  // Agent runs
  createAgentRun(input: run.CreateAgentRunInput): AgentRunRecord {
    return run.createAgentRun(this.db, input);
  }
  finishAgentRun(id: string, status: Exclude<AgentRunStatus, 'running'>): AgentRunRecord | undefined {
    return run.finishAgentRun(this.db, id, status);
  }
  getAgentRun(id: string): AgentRunRecord | undefined {
    return run.getAgentRun(this.db, id);
  }
  appendAgentRunEvent(input: run.AppendAgentRunEventInput): AgentRunEventRecord {
    return run.appendAgentRunEvent(this.db, input);
  }
  listAgentRunEvents(runId: string): AgentRunEventRecord[] {
    return run.listAgentRunEvents(this.db, runId);
  }
  listAgentRuns(sessionId?: string, limit = 50): AgentRunRecord[] {
    return run.listAgentRuns(this.db, sessionId, limit);
  }
  listRunSummaries(sessionId?: string, limit = 50): AgentRunSummary[] {
    return run.listRunSummaries(this.db, sessionId, limit);
  }
  pruneOldRunEvents(cutoffIso: string): number {
    return run.pruneOldRunEvents(this.db, cutoffIso);
  }

  // Reminders
  scheduleReminder(input: Omit<ReminderRecord, 'id' | 'status'>): ReminderRecord {
    return reminder.scheduleReminder(this.db, input);
  }
  listDueReminders(nowIso: string): ReminderRecord[] {
    return reminder.listDueReminders(this.db, nowIso);
  }
  markReminderStatus(id: string, status: ReminderRecord['status']): void {
    reminder.markReminderStatus(this.db, id, status);
  }

  // Recurring jobs
  createRecurringJob(input: recurringJob.RecurringJobInput): RecurringJobRecord {
    return recurringJob.createRecurringJob(this.db, input);
  }
  listRecurringJobs(sessionId?: string): RecurringJobRecord[] {
    return recurringJob.listRecurringJobs(this.db, sessionId);
  }
  listDueRecurringJobs(nowIso: string): RecurringJobRecord[] {
    return recurringJob.listDueRecurringJobs(this.db, nowIso);
  }
  updateRecurringJobNextRun(id: string, nextRunAt: string): RecurringJobRecord | undefined {
    return recurringJob.updateRecurringJobNextRun(this.db, id, nextRunAt);
  }
  deleteRecurringJob(id: string): boolean {
    return recurringJob.deleteRecurringJob(this.db, id);
  }
  getRecurringJob(id: string): RecurringJobRecord | undefined {
    return recurringJob.getRecurringJob(this.db, id);
  }

  // Provider settings
  upsertProviderSettings(settings: ProviderSettings): void {
    providerSettings.upsertProviderSettings(this.db, settings);
  }
  getProviderSettings(workspaceId: string): ProviderSettings | undefined {
    return providerSettings.getProviderSettings(this.db, workspaceId);
  }

  // Briefings + summary
  getMorningBriefing(sessionId: string): MorningBriefing | undefined {
    return briefing.getMorningBriefing(this.db, sessionId);
  }
  getLatestBriefing(workspaceId: string): MorningBriefing | undefined {
    return briefing.getLatestBriefing(this.db, workspaceId);
  }
  getWorkspaceSummary(): WorkspaceSummary {
    return briefing.getWorkspaceSummary(this.db);
  }
}

let store: Store | null = null;

export function getStore(): Store {
  if (!store) {
    store = new Store();
  }

  return store;
}
