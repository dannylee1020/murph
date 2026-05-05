export type ContinuityActionType =
    | 'reply'
    | 'ask'
    | 'redirect'
    | 'defer'
    | 'remind'
    | 'abstain';

export type TaskSource = 'slack_event' | 'discord_event' | 'heartbeat' | 'review_queue';

export type ContinuityCase =
    | 'status_request'
    | 'clarification'
    | 'blocker'
    | 'handoff'
    | 'availability'
    | 'unknown';

export type ActionDisposition =
    | 'auto_sent'
    | 'queued'
    | 'abstained'
    | 'scheduled'
    | 'failed';

export type ProviderName = 'openai' | 'anthropic';

export type SessionMode = 'dry_run' | 'manual_review' | 'auto_send_low_risk';

export type SessionStatus = 'active' | 'stopped' | 'expired';

export type ToolSideEffectClass = 'read' | 'write' | 'external_write';

export interface Workspace {
    id: string;
    provider: ChannelProvider;
    externalWorkspaceId: string;
    name: string;
    botTokenEncrypted?: string;
    botUserId?: string;
    installedAt?: string;
}

export interface UserSchedule {
    timezone: string;
    workdayStartHour: number;
    workdayEndHour: number;
}

export interface AgentUser {
    id: string;
    workspaceId: string;
    externalUserId: string;
    displayName: string;
    fallbackExternalUserId?: string;
    schedule: UserSchedule;
}

export type ChannelProvider = 'slack' | string;

export interface ChannelThreadRef {
    provider?: ChannelProvider;
    channelId: string;
    threadTs: string;
    threadChannelId?: string;
    rootMessageId?: string;
}

export type ThreadRef = ChannelThreadRef;

export interface ChannelMessage {
    provider: ChannelProvider;
    userId?: string;
    authorId?: string;
    text: string;
    ts: string;
    messageId: string;
    createdAt?: string;
}

export type SlackMessage = ChannelMessage;

export interface ContextArtifact {
    id: string;
    source: string;
    type:
        | 'document'
        | 'issue'
        | 'pull_request'
        | 'email'
        | 'event'
        | 'meeting_note'
        | 'transcript'
        | 'link'
        | 'memory'
        | 'file'
        | 'other';
    title: string;
    text: string;
    url?: string;
    metadata?: Record<string, unknown>;
}

export interface UserMemory {
    userId: string;
    preferences: string[];
    fallbackUserId?: string;
    forbiddenTopics: string[];
    briefingStyle?: 'compact' | 'detailed';
    routingHints: string[];
    policy?: UserPolicyProfile;
}

export interface PolicyProfile {
    name: string;
    description: string;
    compiled: CompiledPolicy;
    source: 'filesystem' | 'builtin';
    filePath?: string;
}

export interface CompiledPolicy {
    blockedTopics: string[];
    alwaysQueueTopics: string[];
    blockedActions: ContinuityActionType[];
    requireGroundingForFacts: boolean;
    preferAskWhenUncertain: boolean;
    allowAutoSend: boolean;
    notesForAgent: string[];
}

export interface UserPolicyProfile {
    profileName?: string;
    overrideRaw?: string;
    raw: string;
    compiled: CompiledPolicy;
    compiledAt: string;
    source: 'default' | 'operator_prompt' | 'profile';
    version: number;
}

export interface WorkspaceMemory {
    workspaceId: string;
    channelMappings: Array<{ channelId: string; workstream: string }>;
    escalationRules: string[];
    enabledOptionalTools: string[];
    enabledContextSources: string[];
    enabledPlugins: string[];
    confirmedChannels?: string[];
    defaultPolicyProfileName?: string;
}

export interface ThreadMemory {
    workspaceId: string;
    channelId: string;
    threadTs: string;
    targetUserId?: string;
    workstream?: string;
    linkedArtifacts: string[];
    summary?: string;
    openQuestions: string[];
    blockerNotes: string[];
    lastResolvedAt?: string;
}

export interface FeedbackRecord {
    id: string;
    workspaceId: string;
    sessionId?: string;
    threadTs: string;
    originalAction: ContinuityActionType;
    finalAction: ContinuityActionType;
    note: string;
    createdAt: string;
}

export interface SkillManifest {
    name: string;
    description: string;
    knowledgeDomains?: string[];
    groundingPolicy?:
        | 'model_choice'
        | 'prefer_search'
        | 'required_when_no_artifacts';
    channelNames?: string[];
    sessionModes?: SessionMode[];
    contextSourceNames?: string[];
    priority: number;
    riskLevel?: 'low' | 'medium' | 'high';
    instructions: string;
}

export interface ContextAssembly {
    workspaceId: string;
    task: ContinuityTask;
    targetUserId: string;
    thread: {
        ref: ThreadRef;
        latestMessage: string;
        recentMessages: ChannelMessage[];
        participants: string[];
    };
    memory: {
        user?: UserMemory;
        workspace: WorkspaceMemory;
        thread: ThreadMemory;
    };
    artifacts: ContextArtifact[];
    skills: SkillManifest[];
    availableTools: AgentToolInventoryItem[];
    summary?: string;
    unresolvedQuestions: string[];
    continuityCase: ContinuityCase;
    linkedArtifacts: string[];
}

export interface ContinuityTask {
    id: string;
    source: TaskSource;
    workspaceId: string;
    sessionId?: string;
    thread: ThreadRef;
    targetUserId: string;
    actorUserId?: string;
    rawEventId?: string;
    eventType?: string;
    dedupeKey?: string;
    receivedAt: string;
}

export interface ChannelAdapter {
    id: ChannelProvider;
    displayName: string;
    capabilities: Array<
        | 'event_ingress'
        | 'thread_fetch'
        | 'reply_post'
        | 'message_post'
        | 'membership_check'
        | 'self_join'
    >;
    normalizeEvent(
        event: Record<string, unknown>,
        envelope?: { eventId?: string; teamId?: string },
    ): ContinuityTask | null;
    fetchThread(
        workspace: Workspace,
        thread: ChannelThreadRef,
    ): Promise<ChannelMessage[]>;
    postReply(
        workspace: Workspace,
        thread: ChannelThreadRef,
        text: string,
    ): Promise<void>;
    postMessage?(
        workspace: Workspace,
        channelId: string,
        text: string,
    ): Promise<{ ts?: string }>;
    checkMembership?(
        workspace: Workspace,
        channelId: string,
    ): Promise<ChannelMembershipStatus>;
    ensureMember?(
        workspace: Workspace,
        channelId: string,
    ): Promise<ChannelEnsureMemberResult>;
}

export interface ChannelMembershipStatus {
    id: string;
    name?: string;
    isMember: boolean;
    isPrivate: boolean;
}

export interface ChannelEnsureMemberResult {
    channelId: string;
    name?: string;
    status:
        | 'already_member'
        | 'joined'
        | 'requires_invitation'
        | 'reinstall_required'
        | 'error';
    reason?: string;
}

export interface ContextSource {
    name: string;
    description: string;
    optional?: boolean;
    knowledgeDomains?: string[];
    retrieve(input: {
        workspace: Workspace;
        task: ContinuityTask;
        context: Omit<
            ContextAssembly,
            'artifacts' | 'summary' | 'unresolvedQuestions' | 'continuityCase'
        >;
    }): Promise<ContextArtifact[]>;
}

export interface ExpandedContextSourceNames {
    explicit: string[];
    optional: string[];
}

export interface RuntimeCapabilityManifest {
    channels: Array<{
        id: ChannelProvider;
        displayName: string;
        capabilities: ChannelAdapter['capabilities'];
    }>;
    contextSources: Array<{
        name: string;
        description: string;
        optional: boolean;
        source: string;
        knowledgeDomains?: string[];
    }>;
}

export interface ProposedAction {
    type: ContinuityActionType;
    message: string;
    reason: string;
    confidence: number;
    followUpAt?: string;
    toolsUsed?: string[];
}

export interface PolicyDecision {
    allowed: boolean;
    downgradedTo?: ContinuityActionType;
    disposition: ActionDisposition;
    reason: string;
}

export interface AuditRecord {
    id: string;
    taskId: string;
    workspaceId: string;
    sessionId?: string;
    threadTs: string;
    action: ContinuityActionType;
    disposition: ActionDisposition;
    policyReason: string;
    modelReason: string;
    confidence: number;
    provider?: ProviderName;
    createdAt: string;
}

export interface ReviewItem {
    id: string;
    workspaceId: string;
    sessionId?: string;
    threadTs: string;
    channelId: string;
    targetUserId?: string;
    action: ContinuityActionType;
    disposition?: ActionDisposition;
    message: string;
    reason: string;
    confidence?: number;
    provider?: ProviderName;
    createdAt: string;
}

export interface ThreadStateRecord {
    workspaceId: string;
    sessionId?: string;
    channelId: string;
    threadTs: string;
    targetUserId: string;
    lastMessageTs: string;
    continuityCase: ContinuityCase;
    summary?: string;
    status: string;
    nextHeartbeatAt?: string;
}

export interface ReminderRecord {
    id: string;
    workspaceId: string;
    sessionId?: string;
    channelId: string;
    threadTs: string;
    targetUserId: string;
    dueAt: string;
    status: 'pending' | 'claimed' | 'done';
}

export interface RecurringJobRecord {
    id: string;
    workspaceId: string;
    sessionId?: string;
    jobType: 'morning_digest';
    localTime: string;
    timezone: string;
    payload: {
        channelId: string;
        ownerUserId: string;
    };
    nextRunAt: string;
    status: 'active' | 'paused';
    createdAt: string;
}

export interface ProviderSettings {
    workspaceId: string;
    provider: ProviderName;
    model: string;
}

export interface ProviderDraftResult {
    continuityCase: ContinuityCase;
    summary: string;
    unresolvedQuestions: string[];
    proposedAction: ProposedAction;
}

export interface AgentToolRequest {
    id: string;
    name: string;
    input: unknown;
    reason: string;
}

export interface AgentToolResult {
    id: string;
    name: string;
    ok: boolean;
    output?: unknown;
    error?: string;
}

export interface AgentToolInventoryItem {
    name: string;
    description: string;
    sideEffectClass: ToolSideEffectClass;
    inputSchema?: Record<string, unknown>;
    knowledgeDomains?: string[];
    retrievalEligible?: boolean;
}

export interface ModelProvider {
    readonly name: ProviderName;
    summarizeAndPropose(
        context: Omit<
            ContextAssembly,
            'summary' | 'unresolvedQuestions' | 'continuityCase'
        >,
    ): Promise<ProviderDraftResult>;
}

export type AgentRunStatus = 'running' | 'completed' | 'failed';

export type RuntimeEventType =
    | 'agent.run.started'
    | 'agent.context.built'
    | 'agent.skill.selected'
    | 'agent.model.started'
    | 'agent.model.failed'
    | 'agent.model.completed'
    | 'agent.tool.requested'
    | 'agent.tool.completed'
    | 'agent.policy.decided'
    | 'agent.memory.written'
    | 'agent.action.queued'
    | 'agent.action.sent'
    | 'agent.run.completed'
    | 'agent.run.failed';

export interface AgentRunRecord {
    id: string;
    workspaceId: string;
    sessionId?: string;
    taskId: string;
    channelId: string;
    threadTs: string;
    targetUserId: string;
    status: AgentRunStatus;
    startedAt: string;
    completedAt?: string;
}

export interface AgentRunEventRecord {
    id: string;
    runId: string;
    sequence: number;
    type: RuntimeEventType;
    payload: unknown;
    createdAt: string;
}

export interface AgentRunSummary {
    run: AgentRunRecord;
    contextSummary: string;
    providerResponse: string;
    policyDecision: string;
    executionResult: string;
    skillsUsed: string[];
    toolsUsed: string[];
    createdAt: string;
}

export interface AutopilotSession {
    id: string;
    workspaceId: string;
    ownerUserId: string;
    title: string;
    mode: SessionMode;
    status: SessionStatus;
    channelScope: string[];
    policyProfileName?: string;
    policyOverrideRaw?: string;
    policy?: UserPolicyProfile;
    startedAt: string;
    endsAt: string;
    stoppedAt?: string;
}

export interface MorningBriefing {
    session: AutopilotSession;
    handledCount: number;
    queuedCount: number;
    abstainedCount: number;
    failedCount: number;
    unresolvedItems: ReviewItem[];
    notableThreads: Array<{
        threadTs: string;
        channelId: string;
        action: ContinuityActionType;
        disposition: ActionDisposition;
        reason: string;
        createdAt: string;
    }>;
}

export interface ToolExecutionContext {
    workspace: Workspace;
    session?: AutopilotSession;
    task?: ContinuityTask;
    workspaceMemory?: WorkspaceMemory;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
    name: string;
    description: string;
    sideEffectClass: ToolSideEffectClass;
    inputSchema?: Record<string, unknown>;
    knowledgeDomains?: string[];
    retrievalEligible?: boolean;
    optional?: boolean;
    sessionModes?: SessionMode[];
    requiresWorkspaceEnablement?: boolean;
    supportsDryRun?: boolean;
    execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

export interface ToolInventoryItem {
    name: string;
    description: string;
    sideEffectClass: ToolSideEffectClass;
    inputSchema?: Record<string, unknown>;
    knowledgeDomains?: string[];
    retrievalEligible?: boolean;
    optional: boolean;
    source: string;
    sessionModes?: SessionMode[];
    requiresWorkspaceEnablement?: boolean;
    supportsDryRun?: boolean;
}

export interface PluginManifest {
    id: string;
    name: string;
    description: string;
    version?: string;
}

export type CapabilityStatus =
    | 'loaded'
    | 'disabled'
    | 'misconfigured'
    | 'failed';

export interface RuntimeCapabilityStatus {
    id: string;
    kind: 'plugin' | 'builtin';
    name: string;
    status: CapabilityStatus;
    error?: string;
    capabilities: {
        channels: string[];
        tools: string[];
        contextSources: string[];
        skills: string[];
        providers: string[];
    };
}

export interface PluginRegistrationApi {
    registerTool<TInput = unknown, TOutput = unknown>(
        tool: ToolDefinition<TInput, TOutput>,
        opts?: { optional?: boolean },
    ): void;
    registerChannelAdapter(adapter: ChannelAdapter): void;
    registerContextSource(
        source: ContextSource,
        opts?: { optional?: boolean },
    ): void;
    registerSkill(skill: SkillManifest): void;
    registerProvider(name: ProviderName, factory: () => ModelProvider): void;
}

export interface RuntimePlugin {
    manifest: PluginManifest;
    register(api: PluginRegistrationApi): void | Promise<void>;
}

export interface WorkspaceSummary {
    workspace?: Workspace;
    installUrl?: string;
    provider?: ProviderSettings;
    userCount: number;
    queuedCount: number;
    reminderCount: number;
    activeSessionCount: number;
    latestBriefing?: MorningBriefing;
    channelCount?: number;
    contextSourceCount?: number;
    toolCount?: number;
    pluginCount?: number;
}
