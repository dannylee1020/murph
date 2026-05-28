export type CompiledPolicyPayload = {
    blockedTopics: string[];
    alwaysQueueTopics: string[];
    blockedActions: string[];
    executionMode: string;
    requireGroundingForFacts: boolean;
    preferAskWhenUncertain: boolean;
    allowAutoSend: boolean;
    notesForAgent: string[];
    rules?: unknown[];
};

export type SummaryPayload = {
    summary: {
        workspace?: { id?: string; name: string };
        provider?: { provider: string; model: string };
        userCount: number;
        queuedCount: number;
        reminderCount: number;
        activeSessionCount: number;
        channelCount?: number;
        contextSourceCount?: number;
        toolCount?: number;
        pluginCount?: number;
        installUrl?: string;
        latestBriefing?: {
            session: { title: string; mode: string; stoppedAt?: string };
            handledCount: number;
            queuedCount: number;
            abstainedCount: number;
            failedCount: number;
        };
    };
    users: Array<{
        externalUserId: string;
        displayName: string;
        schedule?: {
            timezone: string;
            workdayStartHour: number;
            workdayEndHour: number;
        };
    }>;
    sessions: Array<{
        id: string;
        workspaceId: string;
        title: string;
        ownerUserId: string;
        mode: string;
        endsAt: string;
        channelScope: string[];
    }>;
    traces: Array<{
        run: { id: string; sessionId?: string; status: string; taskId: string };
        contextSummary?: string;
        executionResult: string;
        createdAt: string;
    }>;
};

export type RuntimePayload = {
    channels: Array<{
        id: string;
        displayName: string;
        capabilities: string[];
    }>;
    contextSources: Array<{
        name: string;
        description: string;
        optional: boolean;
        source: string;
    }>;
    tools: Array<{
        name: string;
        description: string;
        sideEffectClass: string;
        optional: boolean;
        source: string;
    }>;
    plugins: Array<{
        id: string;
        name: string;
        description: string;
        version?: string;
    }>;
    skills: Array<{
        name: string;
        description: string;
        riskLevel: string;
        toolNames: string[];
        contextSourceNames?: string[];
    }>;
    enabledOptionalTools: string[];
    enabledContextSources: string[];
    enabledPlugins: string[];
};

export type SetupCheckStatus = 'ok' | 'warning' | 'action_required' | 'error';

export type SetupDoctorPayload = {
    ok: boolean;
    ready: boolean;
    nextStep:
        | 'core'
        | 'ai'
        | 'slack_config'
        | 'slack_oauth'
        | 'identity'
        | 'channels'
        | 'ready';
    checks: Array<{
        id: string;
        label: string;
        status: SetupCheckStatus;
        message: string;
        fix?: string;
    }>;
};

export type SetupStatusPayload = {
    distribution: 'team' | 'personal';
    productMode: 'personal' | 'channel';
    botRoles?: BotRole[];
    providerBotRoles?: Record<string, BotRole[]>;
    rolesReady?: boolean;
    roleStatus?: Record<
        BotRole,
        {
            selected: boolean;
            ready: boolean;
            providers: Array<{
                provider: string;
                ready: boolean;
                installations: Array<{
                    id: string;
                    workspaceId: string;
                    provider: string;
                    role: BotRole;
                    externalWorkspaceId: string;
                    botUserId?: string;
                    representedUserId?: string;
                    status: 'active' | 'paused';
                }>;
                reason?: string;
            }>;
        }
    >;
    botInstallations?: Array<{
        id: string;
        workspaceId: string;
        provider: string;
        role: 'personal' | 'channel';
        externalWorkspaceId: string;
        botUserId?: string;
        representedUserId?: string;
        status: 'active' | 'paused';
    }>;
    slack: {
        installed: boolean;
        oauthConfigured: boolean;
        signingSecretConfigured: boolean;
        eventsMode: 'socket' | 'http';
        socketConfigured: boolean;
        ownerConfigured?: boolean;
        roles?: Record<BotRole, ProviderRoleSetupStatus>;
        workspace?: ChannelWorkspace;
    };
    discord: {
        installed: boolean;
        clientIdConfigured: boolean;
        clientSecretConfigured?: boolean;
        publicKeyConfigured?: boolean;
        interactionsUrl?: string;
        oauthConfigured?: boolean;
        botTokenConfigured: boolean;
        ownerConfigured?: boolean;
        roles?: Record<BotRole, ProviderRoleSetupStatus>;
        workspace?: ChannelWorkspace;
    };
    provider: {
        configured: boolean;
        defaultProvider: string;
        defaultModel?: string;
        agentProvider?: string;
        agentModel?: string;
        agentInheritsRuntime?: boolean;
        defaultAgentModels?: Record<string, string>;
    };
    notion: {
        configured: boolean;
        version: string;
    };
    channelWorkspaces?: ChannelWorkspace[];
    userConfigured: boolean;
    channelsConfigured: boolean;
};

export type BotRole = 'personal' | 'channel';

export type SetupRoleLinks = {
    appId?: string;
    callbackUrl?: string;
    redirectUri?: string;
    manifestUrl?: string;
    createAppUrl?: string;
    appConfigUrl?: string;
    oauthConfigUrl?: string;
    eventsConfigUrl?: string;
    developerPortalUrl?: string;
    botConfigUrl?: string;
};

export type ProviderRoleSetupStatus = {
    configured: boolean;
    oauthConfigured?: boolean;
    socketConfigured?: boolean;
    installed: boolean;
    ownerConfigured?: boolean;
    representedOwnerConfigured?: boolean;
    workspace?: ChannelWorkspace;
    links?: SetupRoleLinks;
};

export type ChannelWorkspace = {
    id: string;
    provider: string;
    externalWorkspaceId: string;
    name: string;
    botUserId?: string;
    installedAt?: string;
};

export type SetupDefaultsPayload = {
    ok: boolean;
    workspaceId?: string;
    defaults: {
        botRoles?: BotRole[];
        providerBotRoles?: Record<string, BotRole[]>;
        workspaceId?: string;
        channelProvider?: string;
        ownerUserId?: string;
        ownerDisplayName?: string;
        workspaceOwners?: Array<{
            workspaceId: string;
            ownerUserId: string;
            ownerDisplayName?: string;
        }>;
        workspaceChannels?: Array<{
            workspaceId: string;
            channelScopeMode: 'selected' | 'all_accessible';
            selectedChannels: Array<{ id: string; displayName: string }>;
        }>;
        channelScopeMode?: 'selected' | 'all_accessible';
        selectedChannels?: Array<{ id: string; displayName: string }>;
        timezone?: string;
        workdayStartHour?: number;
        workdayEndHour?: number;
    };
    user?: {
        externalUserId: string;
        displayName: string;
        schedule?: {
            timezone: string;
            workdayStartHour: number;
            workdayEndHour: number;
        };
    };
};

export type DiscordSetupPreparePayload = {
    ok: boolean;
    botUserId: string;
    botName: string;
    applicationId: string;
    applicationName?: string;
    applicationPublicKey?: string;
    redirectUri: string;
    developerPortalUrl: string;
    redirectUriRegistered?: boolean;
    permissionsConfigured: boolean;
    intentsConfigured: boolean;
    commandsConfigured?: boolean;
    configurationError?: string;
    installUrl: string;
};

export type SlackSetupPreparePayload = {
    ok: boolean;
    role: BotRole;
    updatedExistingApp: boolean;
    updated: string[];
    appId?: string;
    clientId?: string;
    appTokenConfigured: boolean;
    callbackUrl: string;
    appConfigUrl?: string;
    oauthConfigUrl?: string;
    eventsConfigUrl?: string;
    installUrl: string;
};

export type IntegrationStatusPayload = {
    ok: boolean;
    workspaceId: string;
    integrations: Array<{
        provider: string;
        name: string;
        description: string;
        authType: string;
        credentialLabel: string;
        installPath?: string;
        status: 'connected' | 'disconnected' | 'reconnect_required';
        source?: 'credentials' | 'config' | 'env';
        envKey: string;
        tools: string[];
        contextSources: string[];
        canDisconnect: boolean;
        metadata: {
            masked?: string;
            account?: string;
            validatedAt?: string;
            repositories?: string[];
            needsRepoScope?: boolean;
            oauthConfigured?: boolean;
            vaultPath?: string;
        };
        errorMessage?: string;
    }>;
};

export type GitHubRepositoriesPayload = {
    ok: boolean;
    error?: string;
    repositories: Array<{
        fullName: string;
        private: boolean;
        owner: string;
        name: string;
    }>;
    selectedRepositories: string[];
};

export type SetupChannelsPayload = {
    ok: boolean;
    error?: string;
    workspaceId?: string;
    provider?: string;
    channels: ChannelChoice[];
};

export type ChannelChoice = {
    id: string;
    name?: string;
    displayName: string;
    isMember?: boolean;
    isPrivate?: boolean;
};

export type MemberChoice = {
    id: string;
    displayName: string;
};

export type HomeWorkspaceChannelState = {
    workspace: ChannelWorkspace;
    enabled: boolean;
    mode: 'selected' | 'all_accessible';
    selectedChannels: Array<{ id: string; displayName: string }>;
    availableChannels: ChannelChoice[];
    availableMembers: MemberChoice[];
    selectedOwnerId: string;
    selectedOwnerName: string;
    error?: string;
};

export type QueuePayload = {
    queue: Array<{
        id: string;
        sessionId?: string;
        threadTs: string;
        channelId: string;
        targetUserId?: string;
        action: string;
        reason: string;
        message: string;
        disposition?: string;
    }>;
};

export type TriagePayload = {
    session: {
        id: string;
        title: string;
        mode: string;
        status: string;
        stoppedAt?: string;
    } | null;
    sessions: Array<{
        id: string;
        title: string;
        mode: string;
        status: string;
        stoppedAt?: string;
        triageItemCount?: number;
    }>;
    items: Array<{
        id: string;
        sessionId?: string;
        threadTs: string;
        channelId: string;
        targetUserId?: string;
        action: string;
        disposition?: string;
        reason: string;
        message: string;
        confidence?: number;
        createdAt: string;
        lifecycle?: Array<{
            disposition: string;
            label: string;
            reason: string;
            source: string;
            createdAt: string;
        }>;
        contextSnapshot?: {
            summary: string;
            continuityCase: string;
            thread: {
                messages: Array<{
                    ts: string;
                    authorId?: string;
                    text: string;
                }>;
            };
        };
    }>;
};

export type SessionsPayload = {
    sessions: Array<{ id: string; title: string; mode: string }>;
};

export type AuditPayload = {
    records: Array<{
        createdAt: string;
        sessionId?: string;
        action: string;
        disposition: string;
        policyReason: string;
        provider?: string;
    }>;
};

export type TracesPayload = {
    traces: Array<{
        run: { id: string; sessionId?: string; status: string; taskId: string };
        createdAt: string;
        contextSummary: string;
        executionResult: string;
    }>;
};

export type RunsPayload = {
    runs: Array<{
        id: string;
        sessionId?: string;
        taskId: string;
        channelId: string;
        threadTs: string;
        targetUserId: string;
        status: string;
        startedAt: string;
        completedAt?: string;
    }>;
};

export type RunEventsPayload = {
    events: Array<{
        id: string;
        sequence: number;
        type: string;
        payload: unknown;
        createdAt: string;
    }>;
};

export type RecurringJobsPayload = {
    jobs: Array<{
        id: string;
        sessionId?: string;
        localTime: string;
        timezone: string;
        nextRunAt: string;
        status: string;
        payload: {
            channelId: string;
            ownerUserId: string;
        };
    }>;
};

export type ChannelActionItem = {
    id: string;
    name?: string;
    action?: string;
    reason?: string;
};

export type SessionCreateResponse = {
    ok: boolean;
    session?: { id: string };
    sessions?: Array<{ id: string }>;
    workspace?: { id: string; provider: string; name: string };
    targets?: SessionCreateResponse[];
    autoJoined?: ChannelActionItem[];
    error?: string;
    message?: string;
    requiresInvitation?: ChannelActionItem[];
    reinstallRequired?: boolean;
    reinstallRequiredChannels?: ChannelActionItem[];
    errors?: ChannelActionItem[];
};

export type PolicyProfilesPayload = {
    profiles: Array<{
        name: string;
        description: string;
        compiled: CompiledPolicyPayload;
        source: string;
    }>;
};

export type PolicyConfigPayload = {
    ok: boolean;
    profiles: PolicyProfilesPayload['profiles'];
    policyProfileName?: string;
    mode: string;
    selectedProfileName: string;
    selectedProfile: PolicyProfilesPayload['profiles'][number];
    compiled: CompiledPolicyPayload;
};

export type SubscriptionsPayload = {
    subscriptions: Array<{
        id: string;
        workspaceId: string;
        provider: string;
        externalUserId: string;
        displayName: string;
        status: string;
        channelScopeMode: 'selected' | 'all_accessible';
        channelScope: string[];
        policyProfileName?: string;
        policyMode?: string;
        dashboardAccessEnabled?: boolean;
    }>;
};

export type MeBootstrapPayload = {
    ok: boolean;
    subscription: {
        workspaceId: string;
        provider: string;
        externalUserId: string;
        displayName: string;
        status: 'active' | 'paused';
        channelScopeMode: 'selected' | 'all_accessible';
        channelScope: string[];
        schedule?: {
            timezone: string;
            workdayStartHour: number;
            workdayEndHour: number;
        };
        policyProfileName?: string;
        policyMode?: string;
    };
    workspace?: {
        id: string;
        provider: string;
        name: string;
    };
    activeSessionCount: number;
    queuedCount: number;
};

export type MeSessionsPayload = {
    active: Array<{
        id: string;
        title: string;
        mode: string;
        status: string;
        startedAt: string;
        endsAt: string;
    }>;
    completed: Array<{
        id: string;
        title: string;
        mode: string;
        status: string;
        stoppedAt?: string;
    }>;
};
