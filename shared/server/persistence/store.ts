import { getDb } from '#shared/server/persistence/db';
import type {
  ActionDisposition,
  AgentRunEventRecord,
  AgentRunRecord,
  AgentRunStatus,
  AgentRunSummary,
  AgentUser,
  AppSettings,
  AuditRecord,
  BotAppConfig,
  AutopilotSession,
  BotInstallation,
  BotRole,
  ContinuityActionType,
  MorningBriefing,
  ProviderSettings,
  RecurringJobRecord,
  ReminderRecord,
  ReviewItem,
  SessionStatus,
  TriageItem,
  ThreadMemory,
  ThreadStateRecord,
  UserMemory,
  Workspace,
  WorkspaceMemory,
  WorkspaceSubscription,
  WorkspaceSubscriptionStatus,
  WorkspaceSummary
} from '#shared/types';
import * as action from './stores/action.js';
import * as appSettings from './stores/app-settings.js';
import * as audit from './stores/audit.js';
import * as briefing from './stores/briefing.js';
import * as botAppConfig from './stores/bot-app-config.js';
import * as botInstallation from './stores/bot-installation.js';
import * as integrationCredentials from './stores/integration-credentials.js';
import * as memoryIndex from './stores/memory-index.js';
import * as memory from './stores/memory.js';
import * as providerSettings from './stores/provider-settings.js';
import * as recurringJob from './stores/recurring-job.js';
import * as reminder from './stores/reminder.js';
import * as run from './stores/run.js';
import * as runtimeRefresh from './stores/runtime-refresh.js';
import * as session from './stores/session.js';
import * as subscription from './stores/subscription.js';
import * as directConversation from './stores/direct-conversation.js';
import * as threadState from './stores/thread-state.js';
import * as user from './stores/user.js';
import * as workspace from './stores/workspace.js';

export class Store {
  private readonly db = getDb();

  // App settings
  getAppSettings(): AppSettings {
    return appSettings.getAppSettings(this.db);
  }
  upsertAppSettings(settings: AppSettings): AppSettings {
    return appSettings.upsertAppSettings(this.db, settings);
  }

  // Bot app configs
  upsertBotAppConfig(input: botAppConfig.BotAppConfigInput): BotAppConfig {
    return botAppConfig.upsertBotAppConfig(this.db, input);
  }
  getBotAppConfig(provider: string, role: BotRole): BotAppConfig | undefined {
    return botAppConfig.getBotAppConfig(this.db, provider, role);
  }
  listBotAppConfigs(): BotAppConfig[] {
    return botAppConfig.listBotAppConfigs(this.db);
  }

  // Workspace + slack events
  saveInstall(input: workspace.InstallInput): Workspace {
    const saved = workspace.saveInstall(this.db, input);
    botInstallation.upsertBotInstallation(this.db, {
      workspaceId: saved.id,
      provider: saved.provider,
      role: input.role ?? 'channel',
      externalWorkspaceId: saved.externalWorkspaceId,
      botUserId: saved.botUserId,
      appId: input.appId,
      representedUserId: input.representedUserId
    });
    return saved;
  }
  getWorkspaceByExternalId(provider: string, externalWorkspaceId: string): Workspace | undefined {
    return workspace.getWorkspaceByExternalId(this.db, provider, externalWorkspaceId);
  }
  getWorkspaceById(id: string): Workspace | undefined {
    return workspace.getWorkspaceById(this.db, id);
  }
  getFirstWorkspace(): Workspace | undefined {
    return workspace.getFirstWorkspace(this.db);
  }
  listWorkspaces(): Workspace[] {
    return workspace.listWorkspaces(this.db);
  }
  saveSlackEvent(input: workspace.SlackEventInput): boolean {
    return workspace.saveSlackEvent(this.db, input);
  }
  saveChannelEvent(input: workspace.ChannelEventInput): boolean {
    return workspace.saveChannelEvent(this.db, input);
  }

  // Bot installations
  upsertBotInstallation(input: botInstallation.BotInstallationInput): BotInstallation {
    return botInstallation.upsertBotInstallation(this.db, input);
  }
  getBotInstallation(provider: string, externalWorkspaceId: string, role: BotRole): BotInstallation | undefined {
    return botInstallation.getBotInstallation(this.db, provider, externalWorkspaceId, role);
  }
  getBotInstallationById(id: string): BotInstallation | undefined {
    return botInstallation.getBotInstallationById(this.db, id);
  }
  listBotInstallations(input: { provider?: string; role?: BotRole; workspaceId?: string } = {}): BotInstallation[] {
    return botInstallation.listBotInstallations(this.db, input);
  }

  // User
  upsertUser(input: user.UpsertUserInput): AgentUser {
    return user.upsertUser(this.db, input);
  }
  getUser(workspaceId: string, userId: string): AgentUser | undefined {
    return user.getUser(this.db, workspaceId, userId);
  }
  listUsers(workspaceId?: string): AgentUser[] {
    return user.listUsers(this.db, workspaceId);
  }

  // Workspace subscriptions
  upsertWorkspaceSubscription(input: subscription.WorkspaceSubscriptionInput): WorkspaceSubscription {
    return subscription.upsertWorkspaceSubscription(this.db, input);
  }
  ensureWorkspaceSubscriptionForUser(
    targetUser: AgentUser,
    input: Omit<subscription.WorkspaceSubscriptionInput, 'workspaceId' | 'externalUserId' | 'displayName' | 'schedule'>
  ): WorkspaceSubscription {
    return subscription.ensureWorkspaceSubscriptionForUser(this.db, targetUser, input);
  }
  getWorkspaceSubscription(workspaceId: string, externalUserId: string): WorkspaceSubscription | undefined {
    return subscription.getWorkspaceSubscription(this.db, workspaceId, externalUserId);
  }
  listWorkspaceSubscriptions(workspaceId?: string, status?: WorkspaceSubscriptionStatus): WorkspaceSubscription[] {
    return subscription.listWorkspaceSubscriptions(this.db, workspaceId, status);
  }
  listActiveWorkspaceSubscriptionsForChannel(workspaceId: string, channelId: string): WorkspaceSubscription[] {
    return subscription.listActiveWorkspaceSubscriptionsForChannel(this.db, workspaceId, channelId);
  }
  subscriptionAllowsChannelScope(target: WorkspaceSubscription, channelScope: string[]): boolean {
    return subscription.subscriptionAllowsChannelScope(target, channelScope);
  }

  // Direct conversations
  upsertDirectConversation(input: directConversation.DirectConversationInput) {
    return directConversation.upsertDirectConversation(this.db, input);
  }
  getDirectConversationByChannel(provider: string, channelId: string) {
    return directConversation.getDirectConversationByChannel(this.db, provider, channelId);
  }

  // Memory (user/workspace/thread/feedback)
  getOrCreateUserMemory(workspaceId: string, userId: string): UserMemory {
    return memory.getOrCreateUserMemory(this.db, workspaceId, userId);
  }
  upsertUserMemory(workspaceId: string, userId: string, next: UserMemory): void {
    memory.upsertUserMemory(this.db, workspaceId, userId, next);
  }
  getOrCreateWorkspaceMemory(workspaceId: string): WorkspaceMemory {
    return memory.getOrCreateWorkspaceMemory(this.db, workspaceId);
  }
  upsertWorkspaceMemory(next: WorkspaceMemory): void {
    memory.upsertWorkspaceMemory(this.db, next);
  }
  getOrCreateThreadMemory(workspaceId: string, channelId: string, threadTs: string, targetUserId?: string): ThreadMemory {
    return memory.getOrCreateThreadMemory(this.db, workspaceId, channelId, threadTs, targetUserId);
  }
  getThreadMemory(workspaceId: string, channelId: string, threadTs: string, targetUserId?: string): ThreadMemory | undefined {
    return memory.getThreadMemory(this.db, workspaceId, channelId, threadTs, targetUserId);
  }
  upsertThreadMemory(next: ThreadMemory): void {
    memory.upsertThreadMemory(this.db, next);
  }
  getMemoryIndexRun(runId: string): memoryIndex.MemoryIndexRunRecord | undefined {
    return memoryIndex.getMemoryIndexRun(this.db, runId);
  }
  markMemoryIndexQueued(runId: string): memoryIndex.MemoryIndexRunRecord {
    return memoryIndex.markMemoryIndexQueued(this.db, runId);
  }
  markMemoryIndexIndexed(
    runId: string,
    contentHash: string,
    status?: Extract<memoryIndex.MemoryIndexRunStatus, 'indexed' | 'skipped'>
  ): memoryIndex.MemoryIndexRunRecord {
    return memoryIndex.markMemoryIndexIndexed(this.db, runId, contentHash, status);
  }
  markMemoryIndexFailed(runId: string, error: string): memoryIndex.MemoryIndexRunRecord {
    return memoryIndex.markMemoryIndexFailed(this.db, runId, error);
  }
  listMemoryIndexBacklog(limit = 20): AgentRunRecord[] {
    return memoryIndex.listMemoryIndexBacklog(this.db, limit);
  }

  // Session
  createSession(input: session.SessionInput): AutopilotSession {
    return session.createSession(this.db, input);
  }
  getSessionById(id: string): AutopilotSession | undefined {
    return session.getSessionById(this.db, id);
  }
  listActiveSessions(workspaceId?: string, ownerUserId?: string): AutopilotSession[] {
    return session.listActiveSessions(this.db, workspaceId, ownerUserId);
  }
  listCompletedSessions(workspaceId?: string, limit = 20, ownerUserId?: string): AutopilotSession[] {
    return session.listCompletedSessions(this.db, workspaceId, limit, ownerUserId);
  }
  stopSession(id: string, status: SessionStatus = 'stopped'): void {
    session.stopSession(this.db, id, status);
  }
  expireDueSessions(nowIso: string): AutopilotSession[] {
    return session.expireDueSessions(this.db, nowIso);
  }
  findMatchingSession(
    workspaceId: string,
    ownerUserId: string,
    channelId: string
  ): AutopilotSession | undefined {
    return session.findMatchingSession(this.db, workspaceId, ownerUserId, channelId);
  }
  patchSessionRefresh(id: string, patch: session.SessionRefreshPatch): AutopilotSession | undefined {
    return session.patchSessionRefresh(this.db, id, patch);
  }
  getRuntimeRefreshState(scopeKey: string): runtimeRefresh.RuntimeRefreshState | undefined {
    return runtimeRefresh.getRuntimeRefreshState(this.db, scopeKey);
  }
  markRuntimeRefreshPending(scopeKey: string, reason: string): runtimeRefresh.RuntimeRefreshState {
    return runtimeRefresh.markRuntimeRefreshPending(this.db, scopeKey, reason);
  }
  setRuntimeRefreshState(
    scopeKey: string,
    input: {
      pending?: boolean;
      pendingReasons?: string[];
      lastRevisionJson?: string;
    }
  ): runtimeRefresh.RuntimeRefreshState {
    return runtimeRefresh.setRuntimeRefreshState(this.db, scopeKey, input);
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
  listReviewQueue(workspaceId?: string, sessionId?: string, targetUserId?: string): ReviewItem[] {
    return action.listReviewQueue(this.db, workspaceId, sessionId, targetUserId);
  }
  listTriageItems(workspaceId?: string, sessionId?: string, targetUserId?: string): TriageItem[] {
    return action.listTriageItems(this.db, workspaceId, sessionId, targetUserId);
  }
  countTriageItemsBySession(workspaceId?: string, sessionIds: string[] = []): Map<string, number> {
    return action.countTriageItemsBySession(this.db, workspaceId, sessionIds);
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
  listAgentRuns(sessionId?: string, limit = 50, workspaceId?: string, targetUserId?: string): AgentRunRecord[] {
    return run.listAgentRuns(this.db, sessionId, limit, workspaceId, targetUserId);
  }
  listAgentRunsForThread(workspaceId: string, channelId: string, threadTs: string, limit = 50): AgentRunRecord[] {
    return run.listAgentRunsForThread(this.db, workspaceId, channelId, threadTs, limit);
  }
  listRunSummaries(sessionId?: string, limit = 50, workspaceId?: string, targetUserId?: string): AgentRunSummary[] {
    return run.listRunSummaries(this.db, sessionId, limit, workspaceId, targetUserId);
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

  // Integration connections
  saveIntegrationConnection(
    input: integrationCredentials.SaveIntegrationConnectionInput
  ): integrationCredentials.IntegrationConnection {
    return integrationCredentials.saveCredential(this.db, input);
  }
  getIntegrationConnection(
    workspaceId: string,
    provider: string
  ): integrationCredentials.IntegrationConnection | undefined {
    return integrationCredentials.getCredential(this.db, workspaceId, provider);
  }
  listIntegrationConnections(workspaceId: string): integrationCredentials.IntegrationConnection[] {
    return integrationCredentials.listCredentials(this.db, workspaceId);
  }
  deleteIntegrationConnection(workspaceId: string, provider: string): boolean {
    return integrationCredentials.deleteCredential(this.db, workspaceId, provider);
  }
}

let store: Store | null = null;

export function getStore(): Store {
  if (!store) {
    store = new Store();
  }

  return store;
}
