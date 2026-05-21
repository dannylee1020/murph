import './styles.css';

type CompiledPolicyPayload = {
    blockedTopics: string[];
    alwaysQueueTopics: string[];
    blockedActions: string[];
    requireGroundingForFacts: boolean;
    preferAskWhenUncertain: boolean;
    allowAutoSend: boolean;
    notesForAgent: string[];
    rules?: unknown[];
};

type SummaryPayload = {
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

type RuntimePayload = {
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

type SetupCheckStatus = 'ok' | 'warning' | 'action_required' | 'error';

type SetupDoctorPayload = {
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

type SetupStatusPayload = {
    slack: {
        installed: boolean;
        oauthConfigured: boolean;
        signingSecretConfigured: boolean;
        eventsMode: 'socket' | 'http';
        socketConfigured: boolean;
        ownerConfigured?: boolean;
        workspace?: ChannelWorkspace;
    };
    discord: {
        installed: boolean;
        clientIdConfigured: boolean;
        clientSecretConfigured?: boolean;
        oauthConfigured?: boolean;
        botTokenConfigured: boolean;
        ownerConfigured?: boolean;
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

type ChannelWorkspace = {
    id: string;
    provider: string;
    externalWorkspaceId: string;
    name: string;
    botUserId?: string;
    installedAt?: string;
};

type SetupDefaultsPayload = {
    ok: boolean;
    workspaceId?: string;
    defaults: {
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

type DiscordSetupPreparePayload = {
    ok: boolean;
    botUserId: string;
    botName: string;
    applicationId: string;
    applicationName?: string;
    redirectUri: string;
    developerPortalUrl: string;
    redirectUriRegistered?: boolean;
    permissionsConfigured: boolean;
    intentsConfigured: boolean;
    configurationError?: string;
    installUrl: string;
};

type IntegrationStatusPayload = {
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
        source?: 'credentials' | 'env';
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
        };
        errorMessage?: string;
    }>;
};

type GitHubRepositoriesPayload = {
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

type SetupChannelsPayload = {
    ok: boolean;
    error?: string;
    workspaceId?: string;
    provider?: string;
    channels: ChannelChoice[];
};

type ChannelChoice = {
    id: string;
    name?: string;
    displayName: string;
    isMember?: boolean;
    isPrivate?: boolean;
};

type MemberChoice = {
    id: string;
    displayName: string;
};

type HomeWorkspaceChannelState = {
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

type QueuePayload = {
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

type TriagePayload = {
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

type SessionsPayload = {
    sessions: Array<{ id: string; title: string; mode: string }>;
};

type AuditPayload = {
    records: Array<{
        createdAt: string;
        sessionId?: string;
        action: string;
        disposition: string;
        policyReason: string;
        provider?: string;
    }>;
};

type TracesPayload = {
    traces: Array<{
        run: { id: string; sessionId?: string; status: string; taskId: string };
        createdAt: string;
        contextSummary: string;
        executionResult: string;
    }>;
};

type RunsPayload = {
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

type RunEventsPayload = {
    events: Array<{
        id: string;
        sequence: number;
        type: string;
        payload: unknown;
        createdAt: string;
    }>;
};

type RecurringJobsPayload = {
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

type ChannelActionItem = {
    id: string;
    name?: string;
    action?: string;
    reason?: string;
};

type SessionCreateResponse = {
    ok: boolean;
    session?: { id: string };
    sessions?: Array<{ id: string }>;
    workspace?: { id: string; provider: string; name: string };
    targets?: SessionCreateResponse[];
    autoJoined?: ChannelActionItem[];
    error?: string;
    requiresInvitation?: ChannelActionItem[];
    reinstallRequired?: boolean;
    errors?: ChannelActionItem[];
};

type PolicyProfilesPayload = {
    profiles: Array<{
        name: string;
        description: string;
        compiled: CompiledPolicyPayload;
        source: string;
    }>;
};

type PolicyConfigPayload = {
    ok: boolean;
    profiles: PolicyProfilesPayload['profiles'];
    policyProfileName?: string;
    selectedProfileName: string;
    selectedProfile: PolicyProfilesPayload['profiles'][number];
    compiled: CompiledPolicyPayload;
};

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
    throw new Error('App root not found');
}

const app = root;
let dashboardNotice = '';
let dashboardError = '';
let sidebarActiveSessionCount: number | undefined;
const ADMIN_WORKSPACE_STORAGE_KEY = 'murph_admin_workspace_id';
const HOME_WORKSPACE_STORAGE_KEY = 'murph_home_workspace_id';
const HOME_WORKSPACE_ENABLED_KEY_PREFIX = 'murph_home_workspace_enabled';
const HOME_CHANNEL_SCOPE_MODE_KEY_PREFIX = 'murph_home_channel_scope_mode';
const HOME_SELECTED_CHANNELS_KEY_PREFIX = 'murph_home_selected_channels';
const DEFAULT_AGENT_MODELS: Record<string, string> = {
    openai: 'gpt-5.5',
    anthropic: 'claude-opus-4-7',
};

const navItems = [
    { href: '/', label: 'Home' },
    { href: '/review', label: 'Review' },
    { href: '/triage', label: 'Triage' },
    { href: '/activity', label: 'Activity' },
    { href: '/admin', label: 'Admin' },
];

type ThemePreference = 'auto' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'murph_theme_preference';
const themePreferences: ThemePreference[] = ['auto', 'light', 'dark'];
const darkSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

function getThemePreference(): ThemePreference {
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        return themePreferences.includes(stored as ThemePreference)
            ? (stored as ThemePreference)
            : 'auto';
    } catch {
        return 'auto';
    }
}

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
    if (preference === 'auto') {
        return darkSchemeQuery.matches ? 'dark' : 'light';
    }
    return preference;
}

function applyThemePreference(preference: ThemePreference): void {
    document.documentElement.dataset.theme = resolveTheme(preference);
}

function setThemePreference(preference: ThemePreference): void {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
        // Theme persistence is best-effort; applying the theme still works for this page.
    }
    applyThemePreference(preference);
}

function themeControlHtml(selected: ThemePreference): string {
    return `
    <div class="theme-control" role="group" aria-label="Theme">
      ${themePreferences
          .map(
              (preference) => `
            <button
              type="button"
              class="theme-option ${preference === selected ? 'active' : ''}"
              data-theme-preference="${preference}"
              aria-pressed="${preference === selected ? 'true' : 'false'}"
            >
              ${preference === 'auto' ? 'Auto' : preference === 'light' ? 'Light' : 'Dark'}
            </button>
          `,
          )
          .join('')}
    </div>
  `;
}

applyThemePreference(getThemePreference());
darkSchemeQuery.addEventListener('change', () => {
    if (getThemePreference() === 'auto') {
        applyThemePreference('auto');
    }
});

function activeNavHref(pathname: string): string {
    if (pathname === '/settings') return '/admin';
    if (pathname === '/runs' || pathname === '/audit') return '/activity';
    return pathname;
}

function routeSlug(pathname: string): string {
    if (pathname === '/') return 'home';
    return pathname.replace(/^\//, '').replace(/[^a-z0-9-]/gi, '-') || 'home';
}

function setSidebarWatchingCount(count: number): void {
    sidebarActiveSessionCount = count;
}

type SetupWizardState = {
    currentStep: number;
    selectedProviders: Array<'slack' | 'discord'>;
    providerSelections: Record<
        string,
        {
            workspaceId?: string;
            ownerUserId: string;
            ownerDisplayName: string;
            channelScopeMode: 'selected' | 'all_accessible';
            selectedChannelIds: string[];
            selectedChannels: Array<{ id: string; displayName: string }>;
        }
    >;
    discordPreparation?: DiscordSetupPreparePayload;
    discordRedirectConfirmed: boolean;
    errorMessage: string;
    selectedUserId: string;
    selectedUserName: string;
    channelScopeMode: 'selected' | 'all_accessible';
    selectedChannelIds: string[];
    selectedChannels: Array<{ id: string; displayName: string }>;
    timezone: string;
    workdayStartHour: number;
};

type SetupChannelProvider = 'slack' | 'discord';
type SetupStepKey =
    | 'intro'
    | 'ai'
    | 'providers'
    | 'schedule'
    | `connect:${SetupChannelProvider}`
    | `channels:${SetupChannelProvider}`;

const SETUP_CHANNEL_PROVIDERS: SetupChannelProvider[] = ['slack', 'discord'];

let setupWizardState: SetupWizardState = {
    currentStep: 0,
    selectedProviders: [],
    providerSelections: {},
    discordRedirectConfirmed: false,
    errorMessage: '',
    selectedUserId: '',
    selectedUserName: '',
    channelScopeMode: 'selected',
    selectedChannelIds: [],
    selectedChannels: [],
    timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        'America/Los_Angeles',
    workdayStartHour: 9,
};

function getCurrentUserId(): string {
    return localStorage.getItem('murph_current_user_id') ?? '';
}

function getCurrentUserName(): string {
    return localStorage.getItem('murph_current_user_name') ?? '';
}

function setCurrentUser(id: string, name: string): void {
    localStorage.setItem('murph_current_user_id', id);
    localStorage.setItem('murph_current_user_name', name);
}

function getSelectedChannels(): Array<{ id: string; displayName: string }> {
    const raw = localStorage.getItem('murph_selected_channels');
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as Array<{
            id: string;
            displayName: string;
        }>;
        return parsed.filter(
            (entry) =>
                entry &&
                typeof entry.id === 'string' &&
                typeof entry.displayName === 'string',
        );
    } catch {
        return [];
    }
}

function setSelectedChannels(
    channels: Array<{ id: string; displayName: string }>,
): void {
    localStorage.setItem('murph_selected_channels', JSON.stringify(channels));
}

function agentProvider(setup: SetupStatusPayload): string {
    return (
        setup.provider.agentProvider ??
        setup.provider.defaultProvider ??
        'openai'
    );
}

function agentModel(setup: SetupStatusPayload): string {
    const provider = agentProvider(setup);
    const defaults = setup.provider.defaultAgentModels ?? DEFAULT_AGENT_MODELS;
    return (
        setup.provider.agentModel ??
        defaults[provider] ??
        DEFAULT_AGENT_MODELS.openai
    );
}

function runtimeModel(setup: SetupStatusPayload): string {
    const provider = setup.provider.defaultProvider ?? 'openai';
    const defaults = setup.provider.defaultAgentModels ?? DEFAULT_AGENT_MODELS;
    return (
        setup.provider.defaultModel ??
        defaults[provider] ??
        DEFAULT_AGENT_MODELS.openai
    );
}

function agentModelFields(setup: SetupStatusPayload): string {
    const selectedProvider = agentProvider(setup);
    const selectedModel = agentModel(setup);
    const defaults = setup.provider.defaultAgentModels ?? DEFAULT_AGENT_MODELS;
    const inherits = setup.provider.agentInheritsRuntime !== false;
    return `
    <label>
      <span>Murph Agent default</span>
      <select name="agentModelMode">
        <option value="inherit" ${inherits ? 'selected' : ''}>Inherit runtime model (${escapeHtml(`${setup.provider.defaultProvider} / ${runtimeModel(setup)}`)})</option>
        <option value="custom" ${inherits ? '' : 'selected'}>Use a separate agent model</option>
      </select>
    </label>
    <label>
      <span>Murph Agent provider</span>
      <select name="agentProvider">
        <option value="openai" ${selectedProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
        <option value="anthropic" ${selectedProvider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
      </select>
    </label>
    <label>
      <span>Separate Murph Agent model</span>
      <input name="agentModel" list="agent-model-presets" value="${escapeHtml(selectedModel)}" autocomplete="off" required />
      <datalist id="agent-model-presets">
        <option value="${escapeHtml(defaults.openai ?? DEFAULT_AGENT_MODELS.openai)}">OpenAI recommended</option>
        <option value="${escapeHtml(defaults.anthropic ?? DEFAULT_AGENT_MODELS.anthropic)}">Anthropic recommended</option>
      </datalist>
    </label>
  `;
}

function applySetupDefaults(payload: SetupDefaultsPayload): void {
    const defaults = payload.defaults ?? {};
    if (defaults.ownerUserId) {
        setupWizardState.selectedUserId = defaults.ownerUserId;
        setupWizardState.selectedUserName =
            defaults.ownerDisplayName ?? defaults.ownerUserId;
    }
    setupWizardState.channelScopeMode =
        defaults.channelScopeMode ?? setupWizardState.channelScopeMode;
    if (defaults.selectedChannels) {
        setupWizardState.selectedChannels = defaults.selectedChannels;
        setupWizardState.selectedChannelIds = defaults.selectedChannels.map(
            (channel) => channel.id,
        );
    }
    const schedule = payload.user?.schedule;
    setupWizardState.timezone =
        defaults.timezone ?? schedule?.timezone ?? setupWizardState.timezone;
    setupWizardState.workdayStartHour =
        defaults.workdayStartHour ??
        schedule?.workdayStartHour ??
        setupWizardState.workdayStartHour;
}

function setupErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ApiError) {
        return error.status
            ? `${error.message} (${error.status})`
            : error.message;
    }
    return error instanceof Error ? error.message : fallback;
}

function setupProviderWorkspace(
    setup: SetupStatusPayload,
    provider: SetupChannelProvider,
): ChannelWorkspace | undefined {
    if (provider === 'slack') return setup.slack.workspace;
    return setup.discord.workspace;
}

function setupProviderOwnerConfigured(
    setup: SetupStatusPayload,
    provider: SetupChannelProvider,
): boolean {
    const selection = setupWizardState.providerSelections[provider];
    if (selection?.ownerUserId) return true;
    return provider === 'slack'
        ? setup.slack.ownerConfigured !== false
        : setup.discord.ownerConfigured !== false;
}

function inferSetupProviders(
    setup: SetupStatusPayload,
    defaults: SetupDefaultsPayload,
): SetupChannelProvider[] {
    const workspaceProviders = new Map<string, SetupChannelProvider>(
        adminChannelWorkspaces(setup)
            .filter((workspace) => workspace.provider === 'slack' || workspace.provider === 'discord')
            .map((workspace) => [
                workspace.id,
                workspace.provider as SetupChannelProvider,
            ]),
    );
    const fromWorkspaceChannels = (defaults.defaults.workspaceChannels ?? [])
        .map((entry) => workspaceProviders.get(entry.workspaceId))
        .filter((provider): provider is SetupChannelProvider =>
            provider === 'slack' || provider === 'discord',
        );
    const fromDefaults: SetupChannelProvider | undefined =
        defaults.defaults.channelProvider === 'slack' ||
        defaults.defaults.channelProvider === 'discord'
            ? defaults.defaults.channelProvider
            : undefined;
    const inferred: SetupChannelProvider[] = [
        ...fromWorkspaceChannels,
        ...(fromDefaults ? [fromDefaults] : []),
        ...(setup.slack.installed ? ['slack' as const] : []),
        ...(setup.discord.installed ? ['discord' as const] : []),
    ];
    return Array.from(new Set(inferred));
}

function ensureSetupProviderState(
    setup: SetupStatusPayload,
    defaults: SetupDefaultsPayload,
): void {
    if (setupWizardState.selectedProviders.length === 0) {
        setupWizardState.selectedProviders = inferSetupProviders(
            setup,
            defaults,
        );
    }

    for (const provider of SETUP_CHANNEL_PROVIDERS) {
        const workspace = setupProviderWorkspace(setup, provider);
        const existing = setupWizardState.providerSelections[provider];
        const workspaceChannels = workspace
            ? defaults.defaults.workspaceChannels?.find(
                  (entry) => entry.workspaceId === workspace.id,
              )
            : undefined;
        const owner = workspace
            ? defaultOwnerForWorkspace(
                  workspace,
                  defaults,
                  adminChannelWorkspaces(setup).length,
              )
            : { id: '', name: '' };
        const selectedChannels =
            workspaceChannels?.selectedChannels ??
            (workspace?.id === defaults.workspaceId
                ? (defaults.defaults.selectedChannels ?? [])
                : []);
        setupWizardState.providerSelections[provider] = {
            workspaceId: workspace?.id ?? existing?.workspaceId,
            ownerUserId: existing?.ownerUserId || owner.id,
            ownerDisplayName: existing?.ownerDisplayName || owner.name,
            channelScopeMode:
                existing?.channelScopeMode ??
                workspaceChannels?.channelScopeMode ??
                (workspace?.id === defaults.workspaceId
                    ? (defaults.defaults.channelScopeMode ?? 'selected')
                    : 'selected'),
            selectedChannels:
                existing?.selectedChannels.length ? existing.selectedChannels : selectedChannels,
            selectedChannelIds:
                existing?.selectedChannelIds.length
                    ? existing.selectedChannelIds
                    : selectedChannels.map((channel) => channel.id),
        };
    }
}

function setupStepKeys(): SetupStepKey[] {
    return [
        'intro',
        'ai',
        'providers',
        ...setupWizardState.selectedProviders.flatMap((provider) => {
            const selection = setupWizardState.providerSelections[provider];
            return [
                `connect:${provider}` as const,
                `channels:${provider}` as const,
            ];
        }),
        'schedule',
    ];
}

function advanceSetupStep(
    renderedStepKeys: SetupStepKey[],
    renderedStepIndex: number,
    renderedStepKey: SetupStepKey,
): void {
    const nextStepKeys = setupStepKeys();
    if (renderedStepKey === 'providers') {
        setupWizardState.currentStep = Math.min(
            renderedStepIndex + 1,
            nextStepKeys.length - 1,
        );
        return;
    }

    const intendedNextStep = renderedStepKeys[renderedStepIndex + 1];
    const intendedNextIndex = intendedNextStep
        ? nextStepKeys.indexOf(intendedNextStep)
        : -1;
    setupWizardState.currentStep =
        intendedNextIndex >= 0
            ? intendedNextIndex
            : Math.min(renderedStepIndex + 1, nextStepKeys.length - 1);
}

function splitSetupStep(
    stepKey: SetupStepKey,
): { kind: SetupStepKey; provider?: SetupChannelProvider } {
    if (stepKey.startsWith('connect:')) {
        return {
            kind: 'connect:slack',
            provider: stepKey.split(':')[1] as SetupChannelProvider,
        };
    }
    if (stepKey.startsWith('identity:')) {
        return {
            kind: 'connect:slack',
            provider: stepKey.split(':')[1] as SetupChannelProvider,
        };
    }
    if (stepKey.startsWith('channels:')) {
        return {
            kind: 'channels:slack',
            provider: stepKey.split(':')[1] as SetupChannelProvider,
        };
    }
    return { kind: stepKey };
}

function setupPrimaryProvider(): SetupChannelProvider {
    return setupWizardState.selectedProviders[0] ?? 'slack';
}

function selectedWorkspaceChannelsPayload() {
    return setupWizardState.selectedProviders
        .map((provider) => setupWizardState.providerSelections[provider])
        .filter((selection) => selection?.workspaceId)
        .map((selection) => ({
            workspaceId: selection.workspaceId!,
            channelScopeMode: selection.channelScopeMode,
            selectedChannels:
                selection.channelScopeMode === 'selected'
                    ? selection.selectedChannels
                    : [],
        }));
}

function selectedWorkspaceOwnersPayload() {
    return setupWizardState.selectedProviders
        .map((provider) => setupWizardState.providerSelections[provider])
        .filter((selection) => selection?.workspaceId && selection.ownerUserId)
        .map((selection) => ({
            workspaceId: selection.workspaceId!,
            ownerUserId: selection.ownerUserId,
            ownerDisplayName:
                selection.ownerDisplayName || selection.ownerUserId,
        }));
}

function storageKey(prefix: string, workspaceId: string): string {
    return `${prefix}:${workspaceId}`;
}

function getHomeWorkspaceEnabled(
    workspaceId: string,
    defaultEnabled: boolean,
): boolean {
    const stored = localStorage.getItem(
        storageKey(HOME_WORKSPACE_ENABLED_KEY_PREFIX, workspaceId),
    );
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return defaultEnabled;
}

function setHomeWorkspaceEnabled(workspaceId: string, enabled: boolean): void {
    localStorage.setItem(
        storageKey(HOME_WORKSPACE_ENABLED_KEY_PREFIX, workspaceId),
        String(enabled),
    );
}

function getHomeChannelMode(
    workspaceId: string,
    defaults?: SetupDefaultsPayload['defaults'],
): 'selected' | 'all_accessible' {
    const stored = localStorage.getItem(
        storageKey(HOME_CHANNEL_SCOPE_MODE_KEY_PREFIX, workspaceId),
    );
    if (stored === 'selected' || stored === 'all_accessible') {
        return stored;
    }
    const workspaceChannels = defaults?.workspaceChannels?.find(
        (entry) => entry.workspaceId === workspaceId,
    );
    if (workspaceChannels) return workspaceChannels.channelScopeMode;
    return defaults?.channelScopeMode === 'all_accessible'
        ? 'all_accessible'
        : 'selected';
}

function getHomeSelectedChannels(
    workspaceId: string,
    defaults?: SetupDefaultsPayload['defaults'],
): Array<{ id: string; displayName: string }> {
    const raw = localStorage.getItem(
        storageKey(HOME_SELECTED_CHANNELS_KEY_PREFIX, workspaceId),
    );
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as Array<{
                id: string;
                displayName: string;
            }>;
            return parsed.filter(
                (entry) =>
                    entry &&
                    typeof entry.id === 'string' &&
                    typeof entry.displayName === 'string',
            );
        } catch {}
    }
    const workspaceChannels = defaults?.workspaceChannels?.find(
        (entry) => entry.workspaceId === workspaceId,
    );
    if (workspaceChannels?.channelScopeMode === 'selected') {
        return workspaceChannels.selectedChannels;
    }
    return defaults?.channelScopeMode === 'selected'
        ? (defaults.selectedChannels ?? [])
        : [];
}

function setHomeChannelSelection(
    workspaceId: string,
    mode: 'selected' | 'all_accessible',
    channels: Array<{ id: string; displayName: string }>,
): void {
    localStorage.setItem(
        storageKey(HOME_CHANNEL_SCOPE_MODE_KEY_PREFIX, workspaceId),
        mode,
    );
    localStorage.setItem(
        storageKey(HOME_SELECTED_CHANNELS_KEY_PREFIX, workspaceId),
        JSON.stringify(channels),
    );
}

async function getJson<T>(path: string): Promise<T> {
    const response = await fetch(path);
    const payload = (await response.json().catch(() => ({}))) as T & {
        error?: string;
    };
    if (!response.ok) {
        throw new ApiError(
            payload.error ?? `Request failed: ${path}`,
            response.status,
            payload,
        );
    }
    return payload;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(path, {
        method: 'POST',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => ({}))) as T & {
        error?: string;
    };
    if (!response.ok) {
        throw new ApiError(
            payload.error ?? `Request failed: ${path}`,
            response.status,
            payload,
        );
    }
    return payload;
}

class ApiError<TPayload = unknown> extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly payload: TPayload,
    ) {
        super(message);
    }
}

async function putJson<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(path, {
        method: 'PUT',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => ({}))) as T & {
        error?: string;
    };
    if (!response.ok) {
        throw new ApiError(
            payload.error ?? `Request failed: ${path}`,
            response.status,
            payload,
        );
    }
    return payload;
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function setTitle(title: string): void {
    document.title = title;
}

function formatToday(): string {
    return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    }).format(new Date());
}

function formatSessionStatus(activeCount: number): string {
    if (activeCount === 0) return 'Standing by';
    if (activeCount === 1) return '1 session active';
    return `${activeCount} sessions active`;
}

function formatRelative(iso: string | undefined | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 0) {
        const abs = Math.abs(diff);
        if (abs < 60) return 'in a moment';
        if (abs < 3600) return `in ${Math.floor(abs / 60)}m`;
        if (abs < 86400) return `in ${Math.floor(abs / 3600)}h`;
        return formatDateTime(iso);
    }
    if (diff < 10) return 'just now';
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
    }).format(date);
}

function formatDateTime(iso: string | undefined | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
}

function formatExactIso(iso: string | undefined | null): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
    }).format(date);
}

function titleCase(value: string): string {
    return value
        .replace(/[_.]/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

type ToolCallEntry = {
    id: string;
    name: string;
    requestedAt?: string;
    completedAt?: string;
    durationMs?: number;
    reason?: string;
    input?: unknown;
    status: 'pending' | 'ok' | 'error';
    outputSummary?: string;
    error?: string;
};

function pairToolCalls(events: RunEventsPayload['events']): ToolCallEntry[] {
    const ordered: ToolCallEntry[] = [];
    const byId = new Map<string, ToolCallEntry>();

    for (const event of events) {
        const payload =
            event.payload && typeof event.payload === 'object'
                ? (event.payload as Record<string, unknown>)
                : null;
        if (!payload) continue;
        const id = typeof payload.id === 'string' ? payload.id : undefined;
        if (!id) continue;

        if (event.type === 'agent.tool.requested') {
            const entry: ToolCallEntry = {
                id,
                name:
                    typeof payload.name === 'string' ? payload.name : 'unknown',
                requestedAt: event.createdAt,
                reason:
                    typeof payload.reason === 'string'
                        ? payload.reason
                        : undefined,
                input: payload.input,
                status: 'pending',
            };
            byId.set(id, entry);
            ordered.push(entry);
        } else if (event.type === 'agent.tool.completed') {
            const ok = payload.ok === true;
            const existing = byId.get(id);
            const requestedAt = existing?.requestedAt;
            const completedAt = event.createdAt;
            const durationMs =
                requestedAt && completedAt
                    ? new Date(completedAt).getTime() -
                      new Date(requestedAt).getTime()
                    : undefined;
            const updated: ToolCallEntry = {
                id,
                name:
                    typeof payload.name === 'string'
                        ? payload.name
                        : (existing?.name ?? 'unknown'),
                requestedAt,
                completedAt,
                durationMs:
                    Number.isFinite(durationMs) && (durationMs ?? 0) >= 0
                        ? durationMs
                        : undefined,
                reason: existing?.reason,
                input: existing?.input,
                status: ok ? 'ok' : 'error',
                outputSummary:
                    typeof payload.outputSummary === 'string'
                        ? payload.outputSummary
                        : existing?.outputSummary,
                error:
                    typeof payload.error === 'string'
                        ? payload.error
                        : existing?.error,
            };
            if (existing) {
                Object.assign(existing, updated);
            } else {
                byId.set(id, updated);
                ordered.push(updated);
            }
        }
    }

    return ordered;
}

function formatToolDuration(ms: number | undefined): string {
    if (ms === undefined || !Number.isFinite(ms)) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
}

function statusPillForTool(call: ToolCallEntry): string {
    if (call.status === 'ok') return '<span class="pill pill-ok">OK</span>';
    if (call.status === 'error')
        return '<span class="pill pill-warn">Error</span>';
    return '<span class="pill pill-muted">Pending</span>';
}

function renderToolCallEntry(call: ToolCallEntry): string {
    const inputJson =
        call.input === undefined ? '' : JSON.stringify(call.input, null, 2);
    const rows: string[] = [];
    if (call.reason) {
        rows.push(
            `<div><dt>Reason</dt><dd>${escapeHtml(call.reason)}</dd></div>`,
        );
    }
    if (inputJson) {
        rows.push(
            `<div><dt>Input</dt><dd><pre>${escapeHtml(inputJson)}</pre></dd></div>`,
        );
    }
    if (call.outputSummary) {
        rows.push(
            `<div><dt>Output</dt><dd><pre>${escapeHtml(call.outputSummary)}</pre></dd></div>`,
        );
    }
    if (call.error) {
        rows.push(
            `<div><dt>Error</dt><dd><pre>${escapeHtml(call.error)}</pre></dd></div>`,
        );
    }
    const startedAt = call.requestedAt ?? call.completedAt;
    if (startedAt) {
        rows.push(
            `<div><dt>Started</dt><dd title="${escapeHtml(formatExactIso(startedAt))}">${escapeHtml(formatRelative(startedAt))}</dd></div>`,
        );
    }
    if (rows.length === 0) {
        rows.push(
            '<div><dt>Detail</dt><dd>No additional payload recorded.</dd></div>',
        );
    }

    return `
    <li>
      <details class="tool-call">
        <summary>
          <span aria-hidden="true"></span>
          <span class="tool-call-name">${escapeHtml(call.name)}</span>
          ${statusPillForTool(call)}
          <span class="tool-call-duration">${escapeHtml(formatToolDuration(call.durationMs))}</span>
        </summary>
        <dl class="tool-call-body">
          ${rows.join('')}
        </dl>
      </details>
    </li>
  `;
}

function renderToolCallsDisclosure(events: RunEventsPayload['events']): string {
    const calls = pairToolCalls(events);
    const errorCount = calls.filter((call) => call.status === 'error').length;
    const meta =
        errorCount > 0
            ? `${calls.length} · ${errorCount} error${errorCount === 1 ? '' : 's'}`
            : String(calls.length).padStart(2, '0');

    return `
    <section>
      <details class="disclosure">
        <summary>
          <span>
            <span class="disclosure-label">Tool calls</span>
            <span class="disclosure-count">${escapeHtml(meta)}</span>
          </span>
        </summary>
        ${
            calls.length === 0
                ? '<p class="disclosure-empty">No tool calls recorded for this run.</p>'
                : `<ul class="tool-call-list">${calls.map(renderToolCallEntry).join('')}</ul>`
        }
      </details>
    </section>
  `;
}

function sessionModeLabel(mode: string): string {
    if (mode === 'manual_review') return 'Manual review';
    if (mode === 'dry_run') return 'Dry run';
    if (mode === 'auto_send_low_risk') return 'Low-risk auto-send';
    return titleCase(mode);
}

function policyProfileOptions(
    profiles: PolicyProfilesPayload['profiles'],
    selected: string | undefined,
): string {
    if (profiles.length === 0) {
        return '<option value="" disabled selected>No profiles found</option>';
    }

    const selectedProfile = selected && profiles.some((profile) => profile.name === selected)
        ? selected
        : profiles[0]?.name;

    return profiles
        .map(
            (profile) => `
      <option value="${escapeHtml(profile.name)}" ${profile.name === selectedProfile ? 'selected' : ''}>
        ${escapeHtml(profile.name)}
      </option>
    `,
        )
        .join('');
}

function policySummary(
    profileName: string,
    profileDescription: string | undefined,
    compiled: CompiledPolicyPayload,
): string {
    const rows = [
        ['Selected profile', profileName],
        [
            'Auto-send',
            compiled.allowAutoSend
                ? 'Allowed when session mode allows it'
                : 'Disabled',
        ],
        [
            'Grounding',
            compiled.requireGroundingForFacts
                ? 'Required for factual replies'
                : 'Not required',
        ],
        ['Review topics', compiled.alwaysQueueTopics.join(', ') || 'None'],
        ['Blocked topics', compiled.blockedTopics.join(', ') || 'None'],
    ];
    return `
    <dl class="details policy-summary">
      ${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
    </dl>
    ${profileDescription ? `<p class="policy-note">${escapeHtml(profileDescription)}</p>` : ''}
  `;
}

function policyProfileList(
    profiles: PolicyProfilesPayload['profiles'],
    selectedProfileName: string,
): string {
    if (profiles.length === 0) {
        return '<p class="empty">No policy profiles were found in <code>policies/</code>.</p>';
    }

    return `
    <ul class="list policy-profile-list">
      ${profiles
          .map(
              (profile) => {
                  const selected = profile.name === selectedProfileName;
                  return `
        <li>
          <div class="list-row policy-profile-row" ${selected ? 'aria-current="true"' : ''}>
            <strong>${escapeHtml(profile.name)}${selected ? '<span class="policy-current-label">Current</span>' : ''}</strong>
            <span>${escapeHtml(profile.description)}</span>
          </div>
        </li>
      `;
              },
          )
          .join('')}
    </ul>
  `;
}

function policyProfileDialog(
    profiles: PolicyProfilesPayload['profiles'],
    selectedProfileName: string,
): string {
    return `
    <dialog class="modal" id="policy-profile-dialog">
      <div class="modal-panel">
        <div class="modal-head">
          <div>
            <p class="eyebrow">Policy</p>
            <h2>Policy profiles</h2>
          </div>
          <button type="button" class="ghost close-policy-profiles" aria-label="Close policy profiles">Close</button>
        </div>
        <p class="modal-intro">Review the shipped policy profiles available for new sessions.</p>
        ${policyProfileList(profiles, selectedProfileName)}
        <div class="actions">
          <button type="button" class="secondary close-policy-profiles">Close</button>
        </div>
      </div>
    </dialog>
  `;
}

function consoleStateHtml(label: string, status: 'ok' | 'off' | 'warn'): string {
    return `<span class="console-state"><span class="status-dot ${status}" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

function sidebarWatchingStatusHtml(): string {
    const count = sidebarActiveSessionCount;
    const active = (count ?? 0) > 0;
    const label = count === undefined
        ? 'Checking'
        : active
          ? 'Watching'
          : 'Idle';
    const detail = count === undefined
        ? 'Session status'
        : count === 1
          ? '1 active session'
          : `${count} active sessions`;

    return `
    <div class="sidebar-watch-status" aria-label="${escapeHtml(`Watching status: ${label}`)}">
      <span class="status-dot ${active ? 'ok' : count === undefined ? 'warn' : 'off'}" aria-hidden="true"></span>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(detail)}</strong>
    </div>
  `;
}

function shell(content: string): void {
    const pathname = window.location.pathname;
    const activeHref = activeNavHref(pathname);
    const slug = routeSlug(activeHref);
    const themePreference = getThemePreference();
    app.innerHTML = `
    <div class="app-shell route-${slug}">
      <aside class="sidebar">
        <a class="brand" href="/" data-link>
          <span class="brand-mark" aria-hidden="true"><img src="/img/murph-logo.svg" alt="" /></span>
          <span class="brand-wordmark">Murph</span>
        </a>
        <nav>
          ${navItems
              .map(
                  (item) => `
                <a href="${item.href}" data-link class="${activeHref === item.href ? 'active' : ''}">
                  ${item.label}
                </a>
              `,
              )
              .join('')}
        </nav>
        ${sidebarWatchingStatusHtml()}
        <div class="sidebar-foot">
          ${themeControlHtml(themePreference)}
          <span>Local console</span>
          <strong>${escapeHtml(formatToday())}</strong>
        </div>
      </aside>
      <main class="content" data-route="${slug}">${content}</main>
    </div>
  `;

    app.querySelectorAll<HTMLAnchorElement>('a[data-link]').forEach((link) => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            history.pushState(null, '', link.href);
            void render();
        });
    });

    app.querySelectorAll<HTMLButtonElement>('[data-theme-preference]').forEach(
        (button) => {
            button.addEventListener('click', () => {
                const preference = button.dataset.themePreference as
                    | ThemePreference
                    | undefined;
                if (!preference || !themePreferences.includes(preference))
                    return;
                setThemePreference(preference);
                void render();
            });
        },
    );
}

function loading(title: string): void {
    shell(
        `<section class="page-head"><p class="eyebrow">Murph</p><h1>${title}</h1><p>Loading...</p></section>`,
    );
}

function errorView(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown error';
    shell(`
    <section class="page-head">
      <p class="eyebrow">Error</p>
      <h1>Something went wrong</h1>
      <p class="error">${escapeHtml(message)}</p>
    </section>
  `);
}

function channelName(item: ChannelActionItem): string {
    return item.name ? `#${item.name}` : item.id;
}

function sessionFeedbackHtml(): string {
    if (!dashboardNotice) {
        return '';
    }
    const notice = dashboardNotice;
    dashboardNotice = '';
    return `<div class="notice success">${escapeHtml(notice)}</div>`;
}

function sessionErrorHtml(): string {
    if (!dashboardError) {
        return '';
    }
    const error = dashboardError;
    dashboardError = '';
    return error;
}

function sessionCreateErrorHtml(payload: SessionCreateResponse): string {
    if (payload.targets?.length) {
        return `
      <div class="notice danger">
        <strong>Channel access required</strong>
        ${payload.targets
            .map(
                (target) => `
          <div class="target-error-block">
            <p>${escapeHtml(target.workspace ? `${providerLabel(target.workspace.provider)} · ${target.workspace.name}` : 'Workspace')}</p>
            ${sessionCreateErrorDetails(target)}
          </div>
        `,
            )
            .join('')}
      </div>
    `;
    }

    if (payload.error === 'slack_reconnect_required') {
        return `
      <div class="notice danger">
        <strong>Reconnect Slack</strong>
        <p>Murph cannot read the saved Slack token. Reinstall Slack before starting a session.</p>
        <a class="button" href="/api/slack/install">Reconnect Slack</a>
      </div>
    `;
    }

    if (payload.error !== 'channels_require_action') {
        return `<div class="notice danger">${escapeHtml(payload.error ?? 'Session could not be started.')}</div>`;
    }

    return `
    <div class="notice danger">
      <strong>Channel access required</strong>
      ${sessionCreateErrorDetails(payload)}
    </div>
  `;
}

function sessionCreateErrorDetails(payload: SessionCreateResponse): string {
    const inviteRows = (payload.requiresInvitation ?? [])
        .map(
            (item) => `
        <div class="action-row">
          <span>${escapeHtml(channelName(item))}</span>
          <code>${escapeHtml(item.action ?? '')}</code>
          <button type="button" class="secondary copy-action" data-copy="${escapeHtml(item.action ?? '')}">Copy</button>
        </div>
      `,
        )
        .join('');
    const errorRows = (payload.errors ?? [])
        .map(
            (item) => `
        <div class="action-row">
          <span>${escapeHtml(channelName(item))}</span>
          <code>${escapeHtml(item.reason ?? 'Channel membership check failed')}</code>
        </div>
      `,
        )
        .join('');

    return `
    ${
        payload.reinstallRequired
            ? '<p>The Slack app needs the latest channel scopes before this session can start.</p><a class="button" href="/api/slack/install">Reinstall Slack app</a>'
            : ''
    }
    ${inviteRows ? `<div class="action-list">${inviteRows}</div>` : ''}
    ${errorRows ? `<div class="action-list">${errorRows}</div>` : ''}
  `;
}

function metric(label: string, value: string | number): string {
    return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function providerLabel(provider: string): string {
    if (provider === 'slack') return 'Slack';
    if (provider === 'discord') return 'Discord';
    return titleCase(provider);
}

function discordPreparationDetails(
    preparation: DiscordSetupPreparePayload,
): string {
    const redirectNotice =
        preparation.redirectUriRegistered === true
            ? '<div class="setup-success">Discord OAuth redirect URI is registered</div>'
            : preparation.redirectUriRegistered === false
              ? `<div class="notice danger"><strong>Discord OAuth redirect URI is not registered yet.</strong><p>Add this exact URI in Discord Developer Portal > OAuth2 > General > Redirects, then save changes.</p></div>`
              : `<div class="notice"><strong>Murph could not verify Discord OAuth redirect URIs from the Discord API.</strong><p>Confirm this URI is registered in Discord Developer Portal > OAuth2 > General > Redirects before authorizing Murph.</p></div>`;
    const configurationNotice = preparation.permissionsConfigured
        ? ''
        : `<div class="notice danger"><strong>Discord app configuration automation failed.</strong><p>${escapeHtml(preparation.configurationError ?? 'Open Developer Portal > Bot, enable Message Content Intent, and approve the requested bot permissions.')}</p></div>`;
    const intentNotice =
        preparation.permissionsConfigured && !preparation.intentsConfigured
            ? '<div class="notice"><strong>Discord privileged intents may still need manual review.</strong><p>Open Developer Portal > Bot and confirm Message Content Intent is enabled.</p></div>'
            : '';
    const confirmation =
        preparation.redirectUriRegistered === true
            ? ''
            : `<label class="setup-confirmation">
                 <input type="checkbox" id="discord-redirect-confirmed" ${setupWizardState.discordRedirectConfirmed ? 'checked' : ''} />
                 <span>I added this redirect URI and saved the Discord application.</span>
               </label>`;

    return `
      <div class="setup-success">Discord bot validated: ${escapeHtml(preparation.botName)} (${escapeHtml(preparation.botUserId)})</div>
      ${redirectNotice}
      <div class="setup-copy-block">
        <span>Redirect URI</span>
        <code>${escapeHtml(preparation.redirectUri)}</code>
      </div>
      <div class="setup-copy-block">
        <span>Discord Developer Portal</span>
        <a href="${escapeHtml(preparation.developerPortalUrl)}" target="_blank" rel="noreferrer">${escapeHtml(preparation.developerPortalUrl)}</a>
      </div>
      ${configurationNotice}
      ${intentNotice}
      ${confirmation}
    `;
}

function adminChannelWorkspaces(setup: SetupStatusPayload): ChannelWorkspace[] {
    if (setup.channelWorkspaces?.length) {
        return setup.channelWorkspaces;
    }
    return [setup.slack.workspace, setup.discord.workspace].filter(
        (workspace): workspace is ChannelWorkspace => Boolean(workspace),
    );
}

function workspaceOptionLabel(workspace: ChannelWorkspace): string {
    return `${providerLabel(workspace.provider)} · ${workspace.name}`;
}

type SavedHomeWorkspaceTarget = {
    workspace: ChannelWorkspace;
    mode: 'selected' | 'all_accessible';
    selectedChannels: Array<{ id: string; displayName: string }>;
};

function savedHomeWorkspaceTargets(
    workspaces: ChannelWorkspace[],
): SavedHomeWorkspaceTarget[] {
    return workspaces
        .map((workspace) => ({
            workspace,
            enabled: getHomeWorkspaceEnabled(workspace.id, true),
            mode: getHomeChannelMode(workspace.id),
            selectedChannels: getHomeSelectedChannels(workspace.id),
        }))
        .filter((target) => target.enabled)
        .map(({ workspace, mode, selectedChannels }) => ({
            workspace,
            mode,
            selectedChannels,
        }));
}

function resolveAdminWorkspaceId(workspaces: ChannelWorkspace[]): string {
    const first =
        savedHomeWorkspaceTargets(workspaces)[0]?.workspace.id ??
        workspaces[0]?.id ??
        '';
    if (first) {
        localStorage.setItem(ADMIN_WORKSPACE_STORAGE_KEY, first);
    } else {
        localStorage.removeItem(ADMIN_WORKSPACE_STORAGE_KEY);
    }
    return first;
}

function workspaceMetric(workspaces: ChannelWorkspace[]): string {
    if (workspaces.length === 0) {
        return metric('Workspace', 'Not installed');
    }
    const targets = savedHomeWorkspaceTargets(workspaces);
    if (targets.length === 0) {
        return metric('Workspace', 'No workspace selected');
    }

    return `
    <div class="workspace-kpi workspace-kpi-static">
      <dt>Workspace</dt>
      <dd>
        ${targets
            .map(
                (target) => `
          <span class="workspace-target-line">
            <strong>${escapeHtml(workspaceOptionLabel(target.workspace))}</strong>
            <small>${escapeHtml(channelSummaryLabel(target.mode, target.selectedChannels))}</small>
          </span>
        `,
            )
            .join('')}
      </dd>
    </div>
  `;
}

function channelSummaryLabel(
    mode: 'selected' | 'all_accessible',
    channels: Array<{ id: string; displayName: string }>,
): string {
    if (mode === 'all_accessible' || channels.length === 0) {
        return 'All accessible channels';
    }
    if (channels.length === 1) {
        return channels[0].displayName;
    }
    return `${channels.length} channels`;
}

function channelBadge(channel: ChannelChoice): string {
    if (channel.isPrivate) return 'Private';
    if (channel.isMember) return 'Joined';
    return 'Public';
}

function defaultOwnerForWorkspace(
    workspace: ChannelWorkspace,
    defaultsPayload: SetupDefaultsPayload,
    workspaceCount: number,
): { id: string; name: string } {
    const defaults = defaultsPayload.defaults ?? {};
    const workspaceOwner = defaults.workspaceOwners?.find(
        (owner) => owner.workspaceId === workspace.id,
    );
    if (workspaceOwner?.ownerUserId) {
        return {
            id: workspaceOwner.ownerUserId,
            name: workspaceOwner.ownerDisplayName ?? workspaceOwner.ownerUserId,
        };
    }

    const legacyOwnerApplies = defaults.workspaceId
        ? defaults.workspaceId === workspace.id
        : workspaceCount <= 1;
    if (legacyOwnerApplies && defaults.ownerUserId) {
        return {
            id: defaults.ownerUserId,
            name: defaults.ownerDisplayName ?? defaults.ownerUserId,
        };
    }

    return { id: '', name: '' };
}

function ownerDisplayName(ownerId: string, members: MemberChoice[]): string {
    return members.find((member) => member.id === ownerId)?.displayName ?? ownerId;
}

function combinedChannelSummary(states: HomeWorkspaceChannelState[]): string {
    const enabled = states.filter((state) => state.enabled);
    if (enabled.length === 0) {
        return 'No channels selected';
    }
    if (enabled.length === 1) {
        return `${providerLabel(enabled[0].workspace.provider)} · ${channelSummaryLabel(enabled[0].mode, enabled[0].selectedChannels)}`;
    }
    const providerNames = enabled.map((state) =>
        providerLabel(state.workspace.provider),
    );
    if (enabled.every((state) => state.mode === 'all_accessible')) {
        return `${providerNames.join(' + ')} · all accessible`;
    }
    const selectedCount = enabled.reduce(
        (count, state) =>
            count +
            (state.mode === 'selected' ? state.selectedChannels.length : 0),
        0,
    );
    return selectedCount > 0
        ? `${providerNames.join(' + ')} · ${selectedCount} selected`
        : `${providerNames.join(' + ')} · all accessible`;
}

function missingOwnerNotice(states: HomeWorkspaceChannelState[]): string {
    const missing = states.filter((state) => state.enabled && !state.selectedOwnerId);
    if (missing.length === 0) return '';

    const discordMissing = missing.find((state) => state.workspace.provider === 'discord');
    if (discordMissing) {
        return `
      <div class="notice warning">
        <strong>Discord owner required</strong>
        <p>Run <code>murph setup discord</code> to identify the Discord account Murph should watch for ${escapeHtml(discordMissing.workspace.name)}.</p>
      </div>
    `;
    }

    return `
    <div class="notice warning">
      <strong>Select owner identities</strong>
      <p>Choose an owner for ${escapeHtml(missing.map((state) => workspaceOptionLabel(state.workspace)).join(', '))} in Customize.</p>
    </div>
  `;
}

function homeChannelGroup(state: HomeWorkspaceChannelState): string {
    const selected = new Set(
        state.selectedChannels.map((channel) => channel.id),
    );
    const label = channelSummaryLabel(state.mode, state.selectedChannels);
    const allSelected = state.mode === 'all_accessible';
    const workspaceId = state.workspace.id;
    return `
    <section class="workspace-channel-group ${state.enabled ? '' : 'disabled'}" data-workspace-id="${escapeHtml(workspaceId)}">
      <div class="workspace-channel-header">
        <label class="workspace-channel-toggle">
          <input type="checkbox" name="workspaceTarget" value="${escapeHtml(workspaceId)}" ${state.enabled ? 'checked' : ''} />
          <span>
            <strong>${escapeHtml(workspaceOptionLabel(state.workspace))}</strong>
            <small class="workspace-channel-scope">${escapeHtml(state.enabled ? label : 'Not watched')}</small>
          </span>
        </label>
      </div>
      <div class="channel-selector-body">
        <label class="workspace-owner-select">
          <span>Owner</span>
          <input type="hidden" name="workspaceOwner:${escapeHtml(workspaceId)}" value="${escapeHtml(state.selectedOwnerId)}" />
          <span class="readonly-value">${escapeHtml(state.selectedOwnerName || state.selectedOwnerId || 'Reconnect to identify your account')}</span>
        </label>
        <div class="channel-mode-row" role="group" aria-label="${escapeHtml(`${workspaceOptionLabel(state.workspace)} channel scope`)}">
          <label class="scope-choice ${allSelected ? 'selected' : ''}">
            <input type="radio" name="channelScopeMode:${escapeHtml(workspaceId)}" value="all_accessible" ${allSelected ? 'checked' : ''} />
            <span class="channel-copy">
              <strong>All accessible channels</strong>
              <small>Use every readable channel</small>
            </span>
          </label>
          <label class="scope-choice ${!allSelected ? 'selected' : ''}">
            <input type="radio" name="channelScopeMode:${escapeHtml(workspaceId)}" value="selected" ${allSelected ? '' : 'checked'} />
            <span class="channel-copy">
              <strong>Selected channels</strong>
              <small>Limit this workspace</small>
            </span>
          </label>
        </div>
        ${state.error ? `<p class="field-hint">${escapeHtml(state.error)}</p>` : ''}
        <div class="home-channel-list" aria-label="${escapeHtml(`${workspaceOptionLabel(state.workspace)} channels`)}">
          ${
              state.availableChannels.length > 0
                  ? state.availableChannels
                        .map(
                            (channel) => `
              <label class="channel-choice channel-option ${!allSelected && selected.has(channel.id) ? 'selected' : ''}">
                <input type="checkbox" name="channelScope:${escapeHtml(workspaceId)}" value="${escapeHtml(channel.id)}" data-display-name="${escapeHtml(channel.displayName)}" ${!allSelected && selected.has(channel.id) ? 'checked' : ''} ${allSelected ? 'disabled' : ''} />
                <span class="channel-copy">
                  <strong>${escapeHtml(channel.displayName)}</strong>
                  <small>${escapeHtml(channelBadge(channel))}</small>
                </span>
              </label>
            `,
                        )
                        .join('')
                  : '<p class="empty">No channels are available yet.</p>'
          }
        </div>
      </div>
    </section>
  `;
}

function homeChannelGroups(states: HomeWorkspaceChannelState[]): string {
    return `
    <fieldset class="customize-fieldset home-channel-fieldset">
      <legend>Channels</legend>
      <div class="home-workspace-groups">
        ${
            states.length > 0
                ? states.map((state) => homeChannelGroup(state)).join('')
                : '<p class="empty">Connect Slack or Discord to choose channels.</p>'
        }
      </div>
    </fieldset>
  `;
}

function list(items: string[], emptyText: string): string {
    if (items.length === 0) {
        return `<p class="empty">${escapeHtml(emptyText)}</p>`;
    }
    return `<ul class="list">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function sessionScopeLabel(
    session: SummaryPayload['sessions'][number],
    channelNames: Map<string, string>,
    workspaceNames: Map<string, string>,
): string {
    const scope =
        session.channelScope.length > 0
            ? session.channelScope
                  .map(
                      (id) =>
                          channelNames.get(`${session.workspaceId}:${id}`) ??
                          channelNames.get(id) ??
                          id,
                  )
                  .join(', ')
            : 'All accessible channels';
    const workspace = workspaceNames.get(session.workspaceId);
    return workspace ? `${workspace}: ${scope}` : scope;
}

function activeSessionRows(
    sessions: SummaryPayload['sessions'],
    channelNames: Map<string, string>,
    workspaceNames: Map<string, string>,
): string {
    if (sessions.length === 0) {
        return '<p class="empty">Murph is not watching right now.</p>';
    }

    return `<ul class="list active-session-list">${sessions
        .map(
            (session) => `
        <li>
          <div class="list-row active-session-row">
            <strong>${escapeHtml(session.title)}</strong>
            <span>${escapeHtml(plainLanguageModeLabel(session.mode))}</span>
            <span title="${escapeHtml(formatExactIso(session.endsAt))}">Until ${escapeHtml(formatDateTime(session.endsAt))}</span>
            <span>${escapeHtml(sessionScopeLabel(session, channelNames, workspaceNames))}</span>
            <button class="secondary stop-session" data-session-id="${escapeHtml(session.id)}">Stop</button>
          </div>
        </li>
      `,
        )
        .join('')}</ul>`;
}

function githubRepositorySummary(
    integration: IntegrationStatusPayload['integrations'][number],
): string {
    const repos = integration.metadata.repositories ?? [];
    if (repos.length > 0) {
        return `${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'} selected`;
    }
    return integration.metadata.needsRepoScope
        ? 'Choose repositories before retrieval is enabled'
        : 'No repositories selected';
}

function githubRepositoryDialog(workspaceId: string): string {
    return `
    <dialog class="modal" id="github-repo-dialog">
      <div class="modal-panel">
        <div class="modal-head">
          <div>
            <p class="eyebrow">GitHub</p>
            <h2>Repository scope</h2>
          </div>
          <button type="button" class="ghost close-github-repos" aria-label="Close repository picker">Close</button>
        </div>
        <p class="modal-intro">Choose the repositories Murph can use when grounding replies with GitHub context.</p>
        <div class="github-repo-picker" data-workspace-id="${escapeHtml(workspaceId)}">
          <div class="github-repo-list"><p class="empty">Open this panel to load repositories.</p></div>
          <div class="actions">
            <button type="button" class="secondary close-github-repos">Cancel</button>
            <button type="button" class="save-github-repos" disabled>Save repositories</button>
          </div>
        </div>
      </div>
    </dialog>
  `;
}

function integrationCredentialDialog(workspaceId: string): string {
    return `
    <dialog class="modal" id="integration-credential-dialog">
      <div class="modal-panel">
        <div class="modal-head">
          <div>
            <p class="eyebrow" id="integration-credential-provider">Integration</p>
            <h2 id="integration-credential-title">Connect source</h2>
          </div>
          <button type="button" class="ghost close-integration-credential" aria-label="Close credential form">Close</button>
        </div>
        <p class="modal-intro" id="integration-credential-description"></p>
        <form class="form" id="integration-credential-form" data-workspace-id="${escapeHtml(workspaceId)}">
          <input type="hidden" name="provider" />
          <label>
            <span id="integration-credential-label">API key</span>
            <input type="password" name="credential" autocomplete="off" required />
          </label>
          <p class="field-hint" id="integration-credential-hint"></p>
          <p class="modal-error" id="integration-credential-error" hidden></p>
          <div class="actions">
            <button type="button" class="secondary close-integration-credential">Cancel</button>
            <button type="submit">Connect</button>
          </div>
        </form>
      </div>
    </dialog>
  `;
}

function googleOAuthDialog(workspaceId: string): string {
    const redirectUri = `${window.location.origin}/api/google/oauth/callback`;
    return `
    <dialog class="modal" id="google-oauth-dialog">
      <div class="modal-panel">
        <div class="modal-head">
          <div>
            <p class="eyebrow">Google</p>
            <h2>OAuth setup</h2>
          </div>
          <button type="button" class="ghost close-google-oauth" aria-label="Close Google setup">Close</button>
        </div>
        <p class="modal-intro">Add the OAuth client values before connecting Gmail and Calendar.</p>
        <dl class="details modal-details">
          <div><dt>Redirect URI</dt><dd><code>${escapeHtml(redirectUri)}</code></dd></div>
        </dl>
        <form class="form" id="google-oauth-form" data-workspace-id="${escapeHtml(workspaceId)}">
          <label>
            <span>Client ID</span>
            <input name="clientId" autocomplete="off" required />
          </label>
          <label>
            <span>Client secret</span>
            <input type="password" name="clientSecret" autocomplete="off" required />
          </label>
          <p class="modal-error" id="google-oauth-error" hidden></p>
          <div class="actions">
            <button type="button" class="secondary close-google-oauth">Cancel</button>
            <button type="submit">Save and connect</button>
          </div>
        </form>
      </div>
    </dialog>
  `;
}

function integrationCard(
    integration: IntegrationStatusPayload['integrations'][number],
    workspaceId: string,
): string {
    const connected = integration.status === 'connected';
    const installHref = integration.installPath
        ? `${integration.installPath}?workspaceId=${encodeURIComponent(workspaceId)}`
        : '';

    const detailRows: string[] = [];
    if (connected) {
        if (integration.metadata.account) {
            detailRows.push(
                `<div><dt>Account</dt><dd>${escapeHtml(integration.metadata.account)}</dd></div>`,
            );
        } else if (integration.source === 'env') {
            detailRows.push(
                `<div><dt>Key</dt><dd>Set on this server</dd></div>`,
            );
        } else if (integration.metadata.masked) {
            detailRows.push(
                `<div><dt>Key</dt><dd>${escapeHtml(integration.metadata.masked)}</dd></div>`,
            );
        }
        if (integration.metadata.validatedAt) {
            detailRows.push(
                `<div><dt>Validated</dt><dd>${escapeHtml(formatRelative(integration.metadata.validatedAt))}</dd></div>`,
            );
        }
        if (integration.provider === 'github') {
            detailRows.push(
                `<div><dt>Repositories</dt><dd>${escapeHtml(githubRepositorySummary(integration))}</dd></div>`,
            );
        }
    } else {
        const authLabel =
            integration.status === 'reconnect_required'
                ? 'Reconnect required'
                : integration.authType === 'oauth'
                  ? 'OAuth'
                  : 'API key';
        detailRows.push(
            `<div><dt>Auth</dt><dd>${escapeHtml(authLabel)}</dd></div>`,
        );
        if (integration.tools.length > 0) {
            const toolsLabel =
                integration.tools.length === 1
                    ? '1 tool'
                    : `${integration.tools.length} tools`;
            detailRows.push(
                `<div><dt>Adds</dt><dd>${escapeHtml(toolsLabel)}</dd></div>`,
            );
        }
    }

    const primaryLabel = connected
        ? integration.source === 'env'
            ? 'Override'
            : 'Reconnect'
        : integration.status === 'reconnect_required'
          ? 'Reconnect'
          : 'Connect';
    const primaryCta =
        integration.authType === 'oauth' && installHref
            ? integration.provider === 'google' &&
              !integration.metadata.oauthConfigured
                ? `<button type="button" class="configure-google-oauth" data-install-href="${escapeHtml(installHref)}">${connected || integration.status === 'reconnect_required' ? 'Reconnect' : 'Connect with Google'}</button>`
                : `<a class="button" href="${escapeHtml(installHref)}">${connected || integration.status === 'reconnect_required' ? 'Reconnect' : 'Connect with Google'}</a>`
            : `<button type="button" class="connect-integration" data-provider="${escapeHtml(integration.provider)}">${primaryLabel}</button>`;

    return `
    <article class="panel panel-status">
      <h2><span class="status-dot ${connected ? 'ok' : 'off'}" aria-hidden="true"></span>${escapeHtml(integration.name)}</h2>
      <p>${escapeHtml(integration.description)}</p>
      <dl class="details">${detailRows.join('')}</dl>
      <div class="actions">
        ${primaryCta}
        ${connected && integration.provider === 'github' ? '<button type="button" class="secondary manage-github-repos">Manage repositories</button>' : ''}
        ${integration.canDisconnect ? `<button type="button" class="ghost disconnect-integration" data-provider="${escapeHtml(integration.provider)}">Disconnect</button>` : ''}
      </div>
    </article>
  `;
}

function plainLanguageModeLabel(mode: string): string {
    if (mode === 'manual_review') return 'Show me drafts first';
    if (mode === 'dry_run') return 'Practice run (won’t send anything)';
    if (mode === 'auto_send_low_risk') return 'Auto-handle routine stuff';
    return titleCase(mode);
}

function getTimezoneOptions(): string[] {
    return [
        'Asia/Seoul',
        'Asia/Tokyo',
        'Asia/Shanghai',
        'Asia/Singapore',
        'Asia/Kolkata',
        'Europe/London',
        'Europe/Paris',
        'Europe/Berlin',
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Sao_Paulo',
        'Pacific/Auckland',
        'Australia/Sydney',
    ];
}

function timezoneLabel(tz: string): string {
    const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
    try {
        const offset =
            new Intl.DateTimeFormat('en', {
                timeZone: tz,
                timeZoneName: 'short',
            })
                .formatToParts(new Date())
                .find((p) => p.type === 'timeZoneName')?.value ?? '';
        return `${city} (${offset})`;
    } catch {
        return city;
    }
}

function calculateDurationHours(endHour: number, timezone: string): number {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
    });
    const currentHour = Number(formatter.format(now));
    let hoursUntil = endHour - currentHour;
    if (hoursUntil <= 0) hoursUntil += 24;
    return Math.max(1, Math.min(hoursUntil, 24));
}

function setupCheckList(checks: SetupDoctorPayload['checks']): string {
    return `
    <div class="setup-check-list">
      ${checks
          .filter((check) =>
              [
                  'ai_provider',
                  'slack_socket',
                  'slack_oauth_config',
                  'slack_installed',
                  'discord_ingress',
                  'identity',
                  'channels',
              ].includes(check.id),
          )
          .map(
              (check) => `
          <div class="setup-check ${escapeHtml(check.status)}">
            <strong>${escapeHtml(check.label)}</strong>
            <span>${escapeHtml(check.message)}</span>
          </div>
        `,
          )
          .join('')}
    </div>
  `;
}

async function renderSetup(): Promise<void> {
    setTitle('Murph Setup');
    const params = new URLSearchParams(window.location.search);
    let setupNotice = '';
    const returnedStep = params.get('step');
    const slackCliReturn = returnedStep === 'slack' && params.get('source') === 'cli';
    if (returnedStep === 'slack' && params.get('success') === '1' && !slackCliReturn) {
        setupNotice = '<div class="setup-success">Slack workspace connected</div>';
        setupWizardState.selectedProviders = ['slack'];
        history.replaceState(null, '', '/setup');
    } else if (returnedStep === 'discord' && params.get('success') === '1') {
        setupNotice = '<div class="setup-success">Discord server connected</div>';
        setupWizardState.selectedProviders = ['discord'];
        history.replaceState(null, '', '/setup');
    } else if (params.get('error')) {
        const provider = returnedStep === 'discord' ? 'Discord' : returnedStep === 'slack' ? 'Slack' : 'Setup';
        const reason = params.get('reason') || params.get('error') || 'Setup failed.';
        setupNotice = `<div class="notice danger">${provider} setup failed: ${escapeHtml(reason)}</div>`;
        if (returnedStep === 'slack') setupWizardState.selectedProviders = ['slack'];
        if (returnedStep === 'discord') setupWizardState.selectedProviders = ['discord'];
        history.replaceState(null, '', '/setup');
    }

    let setup: SetupStatusPayload;
    let doctor: SetupDoctorPayload;
    let defaults: SetupDefaultsPayload;
    try {
        [setup, doctor, defaults] = await Promise.all([
            getJson<SetupStatusPayload>('/api/setup/status'),
            getJson<SetupDoctorPayload>('/api/setup/doctor'),
            getJson<SetupDefaultsPayload>('/api/setup/defaults'),
        ]);
    } catch (error) {
        app.innerHTML = `
      <div class="wizard-container">
        <div class="wizard-panel">
          <div class="wizard-header">
            <span class="wizard-brand"><img src="/img/murph-logo.svg" alt="" aria-hidden="true" />Murph</span>
          </div>
          <div class="wizard-step">
            <h1>Setup could not load</h1>
            <div class="notice danger">${escapeHtml(setupErrorMessage(error, 'Murph could not load setup status.'))}</div>
            <div class="wizard-actions">
              <button type="button" id="setup-retry">Retry</button>
            </div>
          </div>
        </div>
      </div>
    `;
        app.querySelector<HTMLButtonElement>('#setup-retry')?.addEventListener('click', () => {
            void renderSetup();
        });
        return;
    }
    applySetupDefaults(defaults);
    ensureSetupProviderState(setup, defaults);

    if (slackCliReturn) {
        const failed = params.get('error') === 'slack_oauth_failed';
        const reason = params.get('reason') || 'Slack app installation failed.';
        history.replaceState(null, '', '/setup');
        app.innerHTML = `
      <div class="wizard-container">
        <div class="wizard-panel">
          <div class="wizard-header">
            <span class="wizard-brand"><img src="/img/murph-logo.svg" alt="" aria-hidden="true" />Murph</span>
          </div>
          <div class="wizard-step">
            <h1>${failed ? 'Slack installation failed' : 'Slack connected'}</h1>
            ${
                failed
                    ? `<div class="notice danger">Slack app installation failed: ${escapeHtml(reason)}</div>`
                    : '<div class="setup-success">Slack workspace connected</div>'
            }
            <p>Return to your terminal to finish setup.</p>
          </div>
        </div>
      </div>
    `;
        return;
    }

    if (setupWizardState.currentStep === 0 && doctor.nextStep !== 'core') {
        setupWizardState.currentStep = doctor.nextStep === 'ai' ? 1 : 2;
    }

    const stepKeys = setupStepKeys();
    if (setupWizardState.currentStep >= stepKeys.length) {
        setupWizardState.currentStep = stepKeys.length - 1;
    }
    const step = setupWizardState.currentStep;
    const stepKey = stepKeys[step] ?? 'intro';
    const splitStep = splitSetupStep(stepKey);
    const stepProvider = splitStep.provider;
    const visibleStep = Math.max(1, step);
    const totalSteps = stepKeys.length - 1;

    const dots = `
    ${Array.from({ length: totalSteps }, (_, i) => {
        const current = visibleStep - 1;
        const cls =
            i < current
                ? 'wizard-dot completed'
                : i === current
                  ? 'wizard-dot active'
                  : 'wizard-dot';
        return `<span class="${cls}"></span>`;
    }).join('')}
    <span style="margin-left: 4px;">${String(visibleStep).padStart(2, '0')} / ${String(totalSteps).padStart(2, '0')}</span>
  `;

    let stepContent = '';

    if (stepKey === 'intro') {
        stepContent = `
      <div class="wizard-step">
        <h1>Set up Murph</h1>
        <p>The installer got the server running. Finish setup here or use <code>murph setup</code> from your terminal.</p>
        ${setupCheckList(doctor.checks)}
        <div class="wizard-actions">
          <button type="button" id="wizard-next">Get started</button>
        </div>
      </div>
    `;
    } else if (stepKey === 'ai') {
        stepContent = `
      <div class="wizard-step">
        <h1>Add an AI provider</h1>
        <p>Murph needs OpenAI or Anthropic before it can draft replies. Choose the model used by <code>murph agent</code> here too.</p>
        ${
            setup.provider.configured
                ? `<div class="setup-success">${escapeHtml(setup.provider.defaultProvider)} is configured</div>
             <form class="form" id="ai-provider-form">
               ${agentModelFields(setup)}
             </form>
             <div class="wizard-actions">
               <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
               <button type="button" id="wizard-next">Save and continue</button>
             </div>`
                : `<form class="form" id="ai-provider-form">
               <label>
                 <span>Provider</span>
                 <select name="provider">
                   <option value="openai">OpenAI</option>
                   <option value="anthropic">Anthropic</option>
                 </select>
               </label>
               <label>
                 <span>API key</span>
                 <input type="password" name="apiKey" autocomplete="off" required />
               </label>
               ${agentModelFields(setup)}
             </form>
             <div class="wizard-actions">
               <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
               <button type="button" id="wizard-next">Save and continue</button>
             </div>`
        }
      </div>
    `;
    } else if (stepKey === 'providers') {
        const providerCards = SETUP_CHANNEL_PROVIDERS.map((provider) => {
            const workspace = setupProviderWorkspace(setup, provider);
            const checked = setupWizardState.selectedProviders.includes(provider);
            const status = workspace
                ? `Connected to ${workspace.name}`
                : provider === 'slack'
                  ? setup.slack.oauthConfigured
                      ? 'Ready to connect'
                      : 'Needs Slack app settings'
                  : setup.discord.botTokenConfigured && setup.discord.clientSecretConfigured
                    ? 'Ready to check OAuth'
                    : 'Needs Discord app settings';
            return `
          <label class="member-item channel-item ${checked ? 'selected' : ''}">
            <input type="checkbox" name="setupProvider" value="${provider}" ${checked ? 'checked' : ''} />
            <span class="member-avatar-placeholder">${provider === 'slack' ? '#' : 'D'}</span>
            <span class="channel-copy">
              <strong>${escapeHtml(providerLabel(provider))}</strong>
              <small>${escapeHtml(status)}</small>
            </span>
          </label>
        `;
        }).join('');
        stepContent = `
      <div class="wizard-step">
        <h1>Choose channel providers</h1>
        <p>Select the places Murph should watch by default. You can configure Slack, Discord, or both.</p>
        <div class="member-list provider-list">${providerCards}</div>
        <div class="wizard-actions">
          <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
          <button type="button" id="wizard-next" ${setupWizardState.selectedProviders.length === 0 ? 'disabled' : ''}>Continue</button>
        </div>
      </div>
    `;
    } else if (stepProvider && stepKey.startsWith('connect:')) {
        if (stepProvider === 'slack') {
            const slackConfigured = setup.slack.socketConfigured && setup.slack.oauthConfigured;
            const slackOwnerMissing = setup.slack.installed && !setupProviderOwnerConfigured(setup, 'slack');
            stepContent = `
      <div class="wizard-step">
        <h1>Create the Slack app</h1>
        <p>Use the manifest at <code>/slack-manifest.yaml</code>, enable Socket Mode, and confirm Slack lists <code>http://localhost:5173/api/slack/oauth/callback</code> under Redirect URLs.</p>
        ${
            slackConfigured
                ? `<div class="setup-success">Slack app config is ready</div>`
                : `<form class="form" id="slack-config-form">
               <label>
                 <span>App-level token</span>
                 <input type="password" name="appToken" placeholder="xapp-..." autocomplete="off" ${setup.slack.socketConfigured ? '' : 'required'} />
               </label>
               <label>
                 <span>Client ID</span>
                 <input name="clientId" autocomplete="off" ${setup.slack.oauthConfigured ? '' : 'required'} />
               </label>
               <label>
                 <span>Client secret</span>
                 <input type="password" name="clientSecret" autocomplete="off" ${setup.slack.oauthConfigured ? '' : 'required'} />
               </label>
             </form>`
        }
        ${setup.slack.installed ? '<div class="setup-success">Slack connected</div>' : ''}
        ${
            slackOwnerMissing
                ? '<div class="notice danger">Slack is connected, but Murph does not know your OAuth identity yet. Reconnect Slack from this setup flow so Murph can lock sessions to your Slack account.</div>'
                : ''
        }
        <div class="wizard-actions">
          <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
          ${
              slackOwnerMissing
                  ? '<a class="button" href="/api/slack/install">Reconnect Slack</a>'
                  : setup.slack.installed
                  ? '<button type="button" id="wizard-next">Continue</button>'
                  : slackConfigured
                    ? '<a class="button" href="/api/slack/install">Connect Slack workspace</a>'
                    : '<button type="button" id="wizard-next">Save and continue</button>'
          }
        </div>
      </div>
    `;
        } else {
            const configured =
                setup.discord.botTokenConfigured &&
                setup.discord.clientIdConfigured &&
                setup.discord.clientSecretConfigured;
            const prepared = setupWizardState.discordPreparation;
            const canInstallDiscord =
                prepared &&
                (prepared.redirectUriRegistered === true ||
                    (prepared.redirectUriRegistered === undefined &&
                        setupWizardState.discordRedirectConfirmed));
            const canRecheckDiscord =
                prepared?.redirectUriRegistered === false &&
                setupWizardState.discordRedirectConfirmed;
            const discordOwnerMissing = setup.discord.installed && !setupProviderOwnerConfigured(setup, 'discord');
            stepContent = `
      <div class="wizard-step">
        <h1>Connect Discord</h1>
        <p>Add the Discord bot token and client secret. Murph will derive the client ID, show the exact OAuth redirect URI, then open Discord authorization.</p>
        ${
            setup.discord.installed
                ? '<div class="setup-success">Discord connected</div>'
                : prepared
                  ? discordPreparationDetails(prepared)
                  : configured
                    ? `<div class="setup-success">Discord app values are saved</div>
                       <p>Check the Discord application before opening authorization.</p>`
                : `<form class="form" id="discord-config-form">
               <label>
                 <span>Bot token</span>
                 <input type="password" name="botToken" autocomplete="off" ${setup.discord.botTokenConfigured ? '' : 'required'} />
               </label>
               <label>
                 <span>Client secret</span>
                 <input type="password" name="clientSecret" autocomplete="off" ${setup.discord.clientSecretConfigured ? '' : 'required'} />
               </label>
             </form>`
        }
        ${
            discordOwnerMissing
                ? '<div class="notice danger">Discord is connected, but Murph does not know your OAuth identity yet. Reconnect Discord from this setup flow so Murph can lock sessions to your Discord account.</div>'
                : ''
        }
        <div class="wizard-actions">
               <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
               ${
                   discordOwnerMissing
                       ? '<a class="button" href="/api/discord/install?source=setup">Reconnect Discord server</a>'
                       : setup.discord.installed
                       ? '<button type="button" id="wizard-next">Continue</button>'
                       : prepared
                         ? canInstallDiscord
                             ? `<a class="button" href="${escapeHtml(prepared.installUrl)}">Connect Discord server</a>`
                             : canRecheckDiscord
                               ? '<button type="button" id="wizard-next">Re-check redirect URI</button>'
                               : '<button type="button" id="wizard-next" disabled>Confirm redirect URI</button>'
                         : '<button type="button" id="wizard-next">Check Discord app</button>'
               }
        </div>
      </div>
    `;
        }
    } else if (stepProvider && stepKey.startsWith('channels:')) {
        const ownerConfigured = setupProviderOwnerConfigured(setup, stepProvider);
        stepContent = `
      <div class="wizard-step">
        <h1>Which channels should Murph watch?</h1>
        <p>Pick the ${escapeHtml(providerLabel(stepProvider))} channels you want covered overnight.</p>
        ${
            ownerConfigured
                ? ''
                : `<div class="notice danger">Reconnect ${escapeHtml(providerLabel(stepProvider))} so Murph can identify your account before saving channel defaults.</div>`
        }
        <div id="channel-list-container"><p class="empty">Loading channels...</p></div>
        <div class="wizard-actions">
          <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
          <button type="button" id="wizard-next" disabled>Continue</button>
        </div>
      </div>
    `;
    } else if (stepKey === 'schedule') {
        stepContent = `
      <div class="wizard-step">
        <h1>Set your schedule</h1>
        <p>When do you usually start your day? Murph will watch until then.</p>
        <form class="form" id="schedule-form">
          <label>
            <span>Timezone</span>
            <select name="timezone">
              ${getTimezoneOptions()
                  .map(
                      (tz) =>
                          `<option value="${escapeHtml(tz)}" ${tz === setupWizardState.timezone ? 'selected' : ''}>${escapeHtml(timezoneLabel(tz))}</option>`,
                  )
                  .join('')}
            </select>
          </label>
          <label>
            <span>I start my day at</span>
            <input type="time" name="startTime" value="${String(setupWizardState.workdayStartHour).padStart(2, '0')}:00" />
          </label>
        </form>
        <div class="wizard-actions">
          <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
          <button type="button" id="wizard-next">Finish setup</button>
        </div>
      </div>
    `;
    }

    app.innerHTML = `
    <div class="wizard-container">
      <div class="wizard-panel">
        <div class="wizard-header">
          <span class="wizard-brand"><img src="/img/murph-logo.svg" alt="" aria-hidden="true" />Murph</span>
          ${step > 0 ? `<div class="wizard-progress-dots">${dots}</div>` : ''}
        </div>
        ${setupNotice}
        ${setupWizardState.errorMessage ? `<div class="notice danger">${escapeHtml(setupWizardState.errorMessage)}</div>` : ''}
        ${stepContent}
      </div>
    </div>
  `;

    app.querySelector<HTMLInputElement>('#discord-redirect-confirmed')?.addEventListener(
        'change',
        (event) => {
            setupWizardState.discordRedirectConfirmed =
                (event.currentTarget as HTMLInputElement).checked;
            void renderSetup();
        },
    );

    if (stepKey === 'providers') {
        const syncProviderSelection = () => {
            const selected = Array.from(
                app.querySelectorAll<HTMLInputElement>(
                    'input[name="setupProvider"]:checked',
                ),
            )
                .map((input) => input.value)
                .filter((provider): provider is SetupChannelProvider =>
                    provider === 'slack' || provider === 'discord',
                );
            setupWizardState.selectedProviders = selected;
            const nextBtn = app.querySelector<HTMLButtonElement>('#wizard-next');
            if (nextBtn) nextBtn.disabled = selected.length === 0;
            app.querySelectorAll<HTMLLabelElement>('.provider-list .member-item')
                .forEach((item) => {
                    const input = item.querySelector<HTMLInputElement>('input');
                    item.classList.toggle('selected', Boolean(input?.checked));
                });
        };
        app.querySelectorAll<HTMLInputElement>('input[name="setupProvider"]')
            .forEach((input) => input.addEventListener('change', syncProviderSelection));
    }

    if (stepProvider && stepKey.startsWith('channels:')) {
        const container = app.querySelector<HTMLDivElement>(
            '#channel-list-container',
        );
        const nextBtn = app.querySelector<HTMLButtonElement>('#wizard-next');
        const selection = setupWizardState.providerSelections[stepProvider];
        const workspace = setupProviderWorkspace(setup, stepProvider);
        const ownerConfigured = setupProviderOwnerConfigured(setup, stepProvider);
        try {
            if (!workspace) {
                throw new Error(`${providerLabel(stepProvider)} is not connected yet.`);
            }
            const channelsPayload = await getJson<SetupChannelsPayload>(
                `/api/setup/channels?provider=${encodeURIComponent(stepProvider)}&workspaceId=${encodeURIComponent(workspace.id)}`,
            );
            if (channelsPayload.channels.length > 0) {
                container!.innerHTML = `
          <label class="member-item channel-item ${selection.channelScopeMode === 'all_accessible' ? 'selected' : ''}">
            <input type="radio" name="setupChannelMode" value="all_accessible" ${selection.channelScopeMode === 'all_accessible' ? 'checked' : ''} />
            <span class="member-avatar-placeholder">*</span>
            <span class="channel-copy">
              <strong>All accessible channels</strong>
              <small>Murph will watch every ${escapeHtml(providerLabel(stepProvider))} channel it can read</small>
            </span>
          </label>
          <label class="member-item channel-item ${selection.channelScopeMode === 'selected' ? 'selected' : ''}">
            <input type="radio" name="setupChannelMode" value="selected" ${selection.channelScopeMode !== 'all_accessible' ? 'checked' : ''} />
            <span class="member-avatar-placeholder">#</span>
            <span class="channel-copy">
              <strong>Selected channels</strong>
              <small>Choose the channels Murph should watch by default</small>
            </span>
          </label>
          <div class="member-list">
            ${channelsPayload.channels
                .map((channel) => {
                    const selected =
                        selection.selectedChannelIds.includes(
                            channel.id,
                        );
                    return `
                <label class="member-item channel-item ${selected ? 'selected' : ''}">
                  <input type="checkbox" name="setupChannelScope" value="${escapeHtml(channel.id)}" ${selected ? 'checked' : ''} />
                  <span class="member-avatar-placeholder">${escapeHtml(channel.displayName.replace('#', '').charAt(0).toUpperCase())}</span>
                  <span class="channel-copy">
                    <strong>${escapeHtml(channel.displayName)}</strong>
                    <small>${escapeHtml(channelBadge(channel))}</small>
                  </span>
                </label>
              `;
                })
                .join('')}
          </div>
        `;

                const syncSelection = () => {
                    const mode =
                        container!.querySelector<HTMLInputElement>(
                            'input[name="setupChannelMode"]:checked',
                        )?.value === 'all_accessible'
                            ? 'all_accessible'
                            : 'selected';
                    const selectedChannels = channelsPayload.channels
                        .filter((channel) => {
                            const input =
                                container!.querySelector<HTMLInputElement>(
                                    `input[value="${CSS.escape(channel.id)}"]`,
                                );
                            return Boolean(input?.checked);
                        })
                        .map((channel) => ({
                            id: channel.id,
                            displayName: channel.displayName,
                        }));
                    selection.channelScopeMode = mode;
                    selection.selectedChannels = selectedChannels;
                    selection.selectedChannelIds = selectedChannels.map(
                        (channel) => channel.id,
                    );
                    if (nextBtn)
                        nextBtn.disabled =
                            !ownerConfigured ||
                            (mode === 'selected' &&
                                selectedChannels.length === 0);
                    container!
                        .querySelectorAll<HTMLInputElement>(
                            'input[name="setupChannelScope"]',
                        )
                        .forEach((input) => {
                            input.disabled = mode === 'all_accessible';
                        });
                    container!
                        .querySelectorAll<HTMLLabelElement>('.channel-item')
                        .forEach((item) => {
                            const input =
                                item.querySelector<HTMLInputElement>('input');
                            item.classList.toggle(
                                'selected',
                                Boolean(input?.checked),
                            );
                        });
                };

                container!
                    .querySelectorAll<HTMLInputElement>(
                        'input[name="setupChannelMode"]',
                    )
                    .forEach((input) => {
                        input.addEventListener('change', syncSelection);
                    });
                container!
                    .querySelectorAll<HTMLInputElement>(
                        'input[name="setupChannelScope"]',
                    )
                    .forEach((input) => {
                        input.addEventListener('change', syncSelection);
                    });
                syncSelection();
            } else {
                throw new Error(`No ${providerLabel(stepProvider)} channels were available.`);
            }
        } catch (error) {
            if (!workspace) {
                container!.innerHTML = `
          <div class="notice danger">${escapeHtml(setupErrorMessage(error, `Connect ${providerLabel(stepProvider)} before choosing channels.`))}</div>
        `;
                if (nextBtn) nextBtn.disabled = true;
                return;
            }
                container!.innerHTML = `
          <div class="notice danger">${escapeHtml(setupErrorMessage(error, `Murph could not load ${providerLabel(stepProvider)} channels.`))}</div>
          <label class="member-item channel-item selected">
            <input type="radio" name="setupChannelMode" value="all_accessible" checked />
            <span class="member-avatar-placeholder">*</span>
            <span class="channel-copy">
              <strong>All accessible channels</strong>
              <small>Use this fallback until channel loading works</small>
            </span>
          </label>
        `;
            selection.channelScopeMode = 'all_accessible';
            selection.selectedChannels = [];
            selection.selectedChannelIds = [];
            if (nextBtn) nextBtn.disabled = !ownerConfigured;
        }
    }

    app.querySelector<HTMLButtonElement>('#wizard-next')?.addEventListener(
        'click',
        async () => {
            setupWizardState.errorMessage = '';
            try {
            if (stepKey === 'ai') {
                const form =
                    app.querySelector<HTMLFormElement>('#ai-provider-form');
                const formData = form ? new FormData(form) : new FormData();
                const provider = String(formData.get('provider') ?? 'openai');
                const apiKey = String(formData.get('apiKey') ?? '').trim();
                const agentModelMode = String(
                    formData.get('agentModelMode') ?? 'inherit',
                );
                const selectedAgentProvider = String(
                    formData.get('agentProvider') ?? agentProvider(setup),
                );
                const selectedAgentModel = String(
                    formData.get('agentModel') ?? agentModel(setup),
                ).trim();
                if (agentModelMode === 'custom' && !selectedAgentModel) return;
                if (!setup.provider.configured && !apiKey) return;
                await postJson('/api/setup/config', {
                    ...(!setup.provider.configured
                        ? {
                              MURPH_DEFAULT_PROVIDER: provider,
                              ...(provider === 'anthropic'
                                  ? { ANTHROPIC_API_KEY: apiKey }
                                  : { OPENAI_API_KEY: apiKey }),
                          }
                        : {}),
                    ...(agentModelMode === 'custom'
                        ? {
                              MURPH_AGENT_PROVIDER: selectedAgentProvider,
                              MURPH_AGENT_MODEL: selectedAgentModel,
                          }
                        : {
                              MURPH_AGENT_PROVIDER: '',
                              MURPH_AGENT_MODEL: '',
                          }),
                });
            }

            if (
                stepProvider === 'slack' &&
                stepKey.startsWith('connect:') &&
                !(setup.slack.socketConfigured && setup.slack.oauthConfigured)
            ) {
                const form =
                    app.querySelector<HTMLFormElement>('#slack-config-form');
                const formData = form ? new FormData(form) : new FormData();
                const appToken = String(formData.get('appToken') ?? '').trim();
                const clientId = String(formData.get('clientId') ?? '').trim();
                const clientSecret = String(
                    formData.get('clientSecret') ?? '',
                ).trim();
                if (
                    (!setup.slack.socketConfigured && !appToken) ||
                    (!setup.slack.oauthConfigured &&
                        (!clientId || !clientSecret))
                )
                    return;
                await postJson('/api/setup/config', {
                    SLACK_EVENTS_MODE: 'socket',
                    SLACK_APP_TOKEN: appToken,
                    SLACK_CLIENT_ID: clientId,
                    SLACK_CLIENT_SECRET: clientSecret,
                });
                await renderSetup();
                return;
            }

            if (
                stepProvider === 'discord' &&
                stepKey.startsWith('connect:') &&
                !setup.discord.installed
            ) {
                const prepared = setupWizardState.discordPreparation;
                if (prepared) {
                    if (
                        prepared.redirectUriRegistered === true ||
                        (prepared.redirectUriRegistered === undefined &&
                            setupWizardState.discordRedirectConfirmed)
                    ) {
                        window.location.href = prepared.installUrl;
                    } else if (
                        prepared.redirectUriRegistered === false &&
                        setupWizardState.discordRedirectConfirmed
                    ) {
                        setupWizardState.discordPreparation = await postJson<DiscordSetupPreparePayload>(
                            '/api/setup/discord/prepare',
                            {},
                        );
                        setupWizardState.discordRedirectConfirmed =
                            setupWizardState.discordPreparation
                                .redirectUriRegistered === true;
                        await renderSetup();
                    }
                    return;
                }
                const form =
                    app.querySelector<HTMLFormElement>('#discord-config-form');
                const formData = form ? new FormData(form) : new FormData();
                const botToken = String(formData.get('botToken') ?? '').trim();
                const clientSecret = String(
                    formData.get('clientSecret') ?? '',
                ).trim();
                if (
                    (!setup.discord.botTokenConfigured && !botToken) ||
                    (!setup.discord.clientSecretConfigured && !clientSecret)
                )
                    return;
                const payload: { botToken?: string; clientSecret?: string } =
                    {};
                if (botToken) payload.botToken = botToken;
                if (clientSecret) payload.clientSecret = clientSecret;
                setupWizardState.discordPreparation = await postJson<DiscordSetupPreparePayload>(
                    '/api/setup/discord/prepare',
                    payload,
                );
                setupWizardState.discordRedirectConfirmed =
                    setupWizardState.discordPreparation.redirectUriRegistered ===
                    true;
                await renderSetup();
                return;
            }

            if (
                stepProvider &&
                stepKey.startsWith('channels:') &&
                setupWizardState.providerSelections[stepProvider].channelScopeMode === 'selected' &&
                setupWizardState.providerSelections[stepProvider].selectedChannelIds.length === 0
            ) {
                return;
            }
            if (stepProvider && stepKey.startsWith('channels:')) {
                const selection = setupWizardState.providerSelections[stepProvider];
                const primary = setupWizardState.providerSelections[setupPrimaryProvider()];
                await putJson('/api/setup/defaults', {
                    channelProvider: setupPrimaryProvider(),
                    workspaceId: primary.workspaceId,
                    ownerUserId: primary.ownerUserId,
                    ownerDisplayName: primary.ownerDisplayName,
                    workspaceOwners: selectedWorkspaceOwnersPayload(),
                    workspaceChannels: selectedWorkspaceChannelsPayload(),
                    channelScopeMode: selection.channelScopeMode,
                    selectedChannels:
                        selection.channelScopeMode === 'selected'
                            ? selection.selectedChannels
                            : [],
                });
            }

            if (stepKey === 'schedule') {
                const form =
                    app.querySelector<HTMLFormElement>('#schedule-form');
                if (form) {
                    const formData = new FormData(form);
                    setupWizardState.timezone = String(
                        formData.get('timezone') ?? setupWizardState.timezone,
                    );
                    const timeVal = String(
                        formData.get('startTime') ?? '09:00',
                    );
                    setupWizardState.workdayStartHour = Number(
                        timeVal.split(':')[0],
                    );
                }

                const primaryProvider = setupPrimaryProvider();
                const primary = setupWizardState.providerSelections[primaryProvider];
                await putJson('/api/setup/defaults', {
                    channelProvider: primaryProvider,
                    workspaceId: primary.workspaceId,
                    ownerUserId: primary.ownerUserId,
                    ownerDisplayName: primary.ownerDisplayName,
                    workspaceOwners: selectedWorkspaceOwnersPayload(),
                    workspaceChannels: selectedWorkspaceChannelsPayload(),
                    channelScopeMode: primary.channelScopeMode,
                    selectedChannels:
                        primary.channelScopeMode === 'selected'
                            ? primary.selectedChannels
                            : [],
                    timezone: setupWizardState.timezone,
                    workdayStartHour: setupWizardState.workdayStartHour,
                    workdayEndHour: setupWizardState.workdayStartHour + 8,
                });
                const setupStatus =
                    await getJson<SetupStatusPayload>('/api/setup/status');
                const missing = [
                    ...(adminChannelWorkspaces(setupStatus).length === 0
                        ? ['workspace connection']
                        : []),
                    ...(!setupStatus.userConfigured ? ['owner identity'] : []),
                    ...(!setupStatus.channelsConfigured
                        ? ['default channels']
                        : []),
                ];
                if (missing.length > 0) {
                    setupWizardState.errorMessage = `Setup is still incomplete: ${missing.join(', ')}.`;
                    await renderSetup();
                    return;
                }

                setCurrentUser(
                    primary.ownerUserId,
                    primary.ownerDisplayName,
                );
                setSelectedChannels(primary.selectedChannels);
                for (const provider of setupWizardState.selectedProviders) {
                    const selection = setupWizardState.providerSelections[provider];
                    if (selection.workspaceId) {
                        setHomeWorkspaceEnabled(selection.workspaceId, true);
                        setHomeChannelSelection(
                            selection.workspaceId,
                            selection.channelScopeMode,
                            selection.selectedChannels,
                        );
                    }
                }
                history.replaceState(null, '', '/');
                await render();
                return;
            }

            advanceSetupStep(stepKeys, step, stepKey);
            await renderSetup();
            } catch (error) {
                setupWizardState.errorMessage = setupErrorMessage(
                    error,
                    'Setup could not save that step.',
                );
                await renderSetup();
            }
        },
    );

    app.querySelector<HTMLButtonElement>('#wizard-back')?.addEventListener(
        'click',
        async () => {
            setupWizardState.currentStep = Math.max(
                0,
                setupWizardState.currentStep - 1,
            );
            await renderSetup();
        },
    );
}

async function renderDashboard(): Promise<void> {
    setTitle('Murph');
    loading('Home');
    const [data, setupStatus, setupDefaults] = await Promise.all([
        getJson<SummaryPayload>('/api/gateway/summary'),
        getJson<SetupStatusPayload>('/api/setup/status'),
        getJson<SetupDefaultsPayload>('/api/setup/defaults'),
    ]);
    setSidebarWatchingCount(data.summary.activeSessionCount);

    const currentUserId =
        setupDefaults.defaults.ownerUserId ?? getCurrentUserId();
    const currentUser = data.users.find(
        (u) => u.externalUserId === currentUserId,
    );
    const workspaces = adminChannelWorkspaces(setupStatus);
    const channelStates = await Promise.all(
        workspaces.map(
            async (workspace): Promise<HomeWorkspaceChannelState> => {
                let availableChannels: ChannelChoice[] = [];
                let channelLoadError = '';
                try {
                    const channelsPayload = await getJson<SetupChannelsPayload>(
                        `/api/setup/channels?workspaceId=${encodeURIComponent(workspace.id)}`,
                    );
                    availableChannels = channelsPayload.channels ?? [];
                } catch (error) {
                    channelLoadError =
                        error instanceof Error
                            ? error.message
                            : 'Murph could not load channels right now.';
                }

                const defaults = setupDefaults.defaults;
                let mode = getHomeChannelMode(workspace.id, defaults);
                let selectedChannels = getHomeSelectedChannels(
                    workspace.id,
                    defaults,
                );
                const defaultOwner = defaultOwnerForWorkspace(
                    workspace,
                    setupDefaults,
                    workspaces.length,
                );
                const selectedOwnerId = defaultOwner.id;
                const availableMembers = selectedOwnerId
                    ? [{ id: selectedOwnerId, displayName: defaultOwner.name || selectedOwnerId }]
                    : [];
                if (channelLoadError || availableChannels.length === 0) {
                    mode = 'all_accessible';
                    selectedChannels = [];
                }
                if (mode === 'selected' && selectedChannels.length === 0) {
                    mode = 'all_accessible';
                }
                if (
                    availableChannels.length > 0 &&
                    selectedChannels.length > 0
                ) {
                    const byId = new Map(
                        availableChannels.map((channel) => [
                            channel.id,
                            channel,
                        ]),
                    );
                    selectedChannels = selectedChannels
                        .filter((channel) => byId.has(channel.id))
                        .map((channel) => ({
                            id: channel.id,
                            displayName:
                                byId.get(channel.id)?.displayName ??
                                channel.displayName,
                        }));
                    if (mode === 'selected' && selectedChannels.length === 0) {
                        mode = 'all_accessible';
                    }
                }

                return {
                    workspace,
                    enabled: getHomeWorkspaceEnabled(workspace.id, true),
                    mode,
                    selectedChannels,
                    availableChannels,
                    availableMembers,
                    selectedOwnerId,
                    selectedOwnerName: selectedOwnerId
                        ? ownerDisplayName(selectedOwnerId, availableMembers)
                        : '',
                    error: channelLoadError,
                };
            },
        ),
    );
    const selectedChannelNames = new Map(
        channelStates.flatMap((state) => [
            ...state.availableChannels.map(
                (channel) =>
                    [
                        `${state.workspace.id}:${channel.id}`,
                        channel.displayName,
                    ] as const,
            ),
            ...state.selectedChannels.map(
                (channel) =>
                    [
                        `${state.workspace.id}:${channel.id}`,
                        channel.displayName,
                    ] as const,
            ),
        ]),
    );
    const workspaceNames = new Map(
        workspaces.map(
            (workspace) =>
                [workspace.id, workspaceOptionLabel(workspace)] as const,
        ),
    );
    const userTz = currentUser?.schedule?.timezone ?? setupWizardState.timezone;
    const userStartHour =
        currentUser?.schedule?.workdayStartHour ??
        setupWizardState.workdayStartHour;
    const estimatedHours = calculateDurationHours(userStartHour, userTz);
    const providerBanner = !setupStatus.provider.configured
        ? `<div class="setup-banner">
        <p>Connect an AI provider to let Murph draft replies for you.</p>
        <a class="button secondary" href="/admin">Configure</a>
      </div>`
        : '';
    const ownerNotice = missingOwnerNotice(channelStates);

    shell(`
    <section class="page-head console-head">
      <div>
        <p class="eyebrow">${escapeHtml(formatToday())} · ${escapeHtml(formatSessionStatus(data.summary.activeSessionCount))}</p>
        <h1>Home</h1>
      </div>
      ${consoleStateHtml(setupStatus.provider.configured ? 'Ready' : 'Setup needed', setupStatus.provider.configured ? 'ok' : 'off')}
    </section>

    ${providerBanner}
    ${sessionFeedbackHtml()}
    ${sessionErrorHtml()}

    <section class="launch-section">
      <article class="panel go-to-sleep-card">
        <h2>Go to sleep</h2>
        <p>Murph will watch your accessible channels and queue drafts for your review.</p>
        <form id="go-to-sleep-form">
          <dl class="go-to-sleep-summary">
            <div class="summary-cell">
              <dt>Watching</dt>
              <dd>${escapeHtml(combinedChannelSummary(channelStates))}</dd>
            </div>
            <div class="summary-cell">
              <dt>Until</dt>
              <dd>${String(userStartHour).padStart(2, '0')}:00 ${escapeHtml(userTz.split('/').pop()?.replace(/_/g, ' ') ?? userTz)} (~${estimatedHours}h)</dd>
            </div>
            <div class="summary-cell">
              <dt>Mode</dt>
              <dd>Show me drafts first</dd>
            </div>
          </dl>
          ${ownerNotice}
          <button type="submit" class="primary-large">Start watching</button>

          <details class="customize-section">
            <summary>Customize</summary>
            ${homeChannelGroups(channelStates)}
            <fieldset class="customize-fieldset">
              <legend>Review mode</legend>
              <div class="mode-selector">
                <label class="mode-radio">
                  <input type="radio" name="mode" value="manual_review" checked />
                  <span class="mode-label">Show me drafts first</span>
                  <span class="mode-description">Review all proposed replies before sending</span>
                </label>
                <label class="mode-radio">
                  <input type="radio" name="mode" value="auto_send_low_risk" />
                  <span class="mode-label">Auto-handle routine stuff</span>
                  <span class="mode-description">Send low-risk items automatically, queue the rest</span>
                </label>
                <label class="mode-radio">
                  <input type="radio" name="mode" value="dry_run" />
                  <span class="mode-label">Practice run</span>
                  <span class="mode-description">Simulate without actually sending anything</span>
                </label>
              </div>
            </fieldset>
            <fieldset class="customize-fieldset">
              <legend>Stop watching at</legend>
              <div class="form">
                <label>
                  <span>Time</span>
                  <input type="time" name="endTime" value="${String(userStartHour).padStart(2, '0')}:00" />
                </label>
                <label>
                  <span>Timezone</span>
                  <select name="timezone">
                    ${getTimezoneOptions()
                        .map(
                            (tz) =>
                                `<option value="${escapeHtml(tz)}" ${tz === userTz ? 'selected' : ''}>${escapeHtml(timezoneLabel(tz))}</option>`,
                        )
                        .join('')}
                  </select>
                </label>
              </div>
            </fieldset>
            <div class="customize-actions">
              <button type="button" class="secondary save-customize">Save</button>
              <span class="field-hint customize-save-status" aria-live="polite"></span>
            </div>
          </details>
        </form>

        <section class="active-session-inline">
          <div class="section-head">
            <h2>Currently watching</h2>
            <span class="section-meta">${escapeHtml(formatSessionStatus(data.summary.activeSessionCount))}</span>
          </div>
          ${activeSessionRows(data.sessions, selectedChannelNames, workspaceNames)}
        </section>
      </article>
    </section>
  `);

    const syncHomeChannelSelection = () => {
        const form = app.querySelector<HTMLFormElement>('#go-to-sleep-form');
        if (!form) return;
        const nextStates = channelStates.map((state) => {
            const group = form.querySelector<HTMLElement>(
                `.workspace-channel-group[data-workspace-id="${state.workspace.id}"]`,
            );
            const enabled = Boolean(
                group?.querySelector<HTMLInputElement>(
                    'input[name="workspaceTarget"]',
                )?.checked,
            );
            const mode: 'selected' | 'all_accessible' =
                group?.querySelector<HTMLInputElement>(
                    `input[name="channelScopeMode:${state.workspace.id}"]:checked`,
                )?.value === 'all_accessible'
                    ? 'all_accessible'
                    : 'selected';
            const checkboxes = Array.from(
                group?.querySelectorAll<HTMLInputElement>(
                    `input[name="channelScope:${state.workspace.id}"]`,
                ) ?? [],
            );
            const ownerInput = group?.querySelector<HTMLInputElement>(
                `input[name="workspaceOwner:${state.workspace.id}"]`,
            );
            if (ownerInput) {
                ownerInput.disabled = !enabled;
            }
            const selectedOwnerId = enabled ? (ownerInput?.value ?? '') : '';
            checkboxes.forEach((checkbox) => {
                checkbox.disabled = !enabled || mode === 'all_accessible';
            });
            const currentChannels =
                mode === 'all_accessible'
                    ? []
                    : checkboxes
                          .filter((checkbox) => checkbox.checked)
                          .map((checkbox) => ({
                              id: checkbox.value,
                              displayName:
                                  checkbox.dataset.displayName ??
                                  checkbox.value,
                          }));
            const label = channelSummaryLabel(mode, currentChannels);
            const toggleLabel = group?.querySelector<HTMLElement>(
                '.workspace-channel-scope',
            );
            if (toggleLabel)
                toggleLabel.textContent = enabled ? label : 'Not watched';
            group?.classList.toggle('disabled', !enabled);
            group
                ?.querySelectorAll<HTMLLabelElement>(
                    '.channel-choice, .scope-choice',
                )
                .forEach((choice) => {
                    const input =
                        choice.querySelector<HTMLInputElement>('input');
                    choice.classList.toggle(
                        'selected',
                        Boolean(input?.checked),
                    );
                });
            return {
                ...state,
                enabled,
                mode,
                selectedChannels: currentChannels,
                selectedOwnerId,
                selectedOwnerName: selectedOwnerId
                    ? ownerDisplayName(selectedOwnerId, state.availableMembers)
                    : '',
            };
        });
        const summaryCell = form.querySelector<HTMLElement>(
            '.go-to-sleep-summary .summary-cell:first-child dd',
        );
        if (summaryCell)
            summaryCell.textContent = combinedChannelSummary(nextStates);
        const submitButton = form.querySelector<HTMLButtonElement>(
            'button[type="submit"]',
        );
        if (submitButton) {
            const enabledStates = nextStates.filter((state) => state.enabled);
            submitButton.disabled =
                enabledStates.length === 0 ||
                enabledStates.some((state) => !state.selectedOwnerId) ||
                enabledStates.some(
                    (state) =>
                        state.mode === 'selected' &&
                        state.selectedChannels.length === 0,
                );
        }
    };

    app.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        'input[name="workspaceTarget"], input[name^="channelScopeMode:"], input[name^="channelScope:"]',
    ).forEach((input) => {
        input.addEventListener('change', syncHomeChannelSelection);
    });
    syncHomeChannelSelection();

    function homeTargetsFromForm(form: HTMLFormElement, persist: boolean) {
        const formData = new FormData(form);
        const enabledWorkspaceIds = new Set(
            formData.getAll('workspaceTarget').map((value) => String(value)),
        );
        return channelStates
            .map((state) => {
                const enabled = enabledWorkspaceIds.has(state.workspace.id);
                const channelMode: 'selected' | 'all_accessible' =
                    String(
                        formData.get(
                            `channelScopeMode:${state.workspace.id}`,
                        ) ?? state.mode,
                    ) === 'all_accessible'
                        ? 'all_accessible'
                        : 'selected';
                const checkedChannelIds = new Set(
                    formData
                        .getAll(`channelScope:${state.workspace.id}`)
                        .map((value) => String(value)),
                );
                const ownerUserId = String(
                    formData.get(`workspaceOwner:${state.workspace.id}`) ?? '',
                );
                const submittedChannels = state.availableChannels
                    .filter((channel) => checkedChannelIds.has(channel.id))
                    .map((channel) => ({
                        id: channel.id,
                        displayName: channel.displayName,
                    }));
                if (persist) {
                    setHomeWorkspaceEnabled(state.workspace.id, enabled);
                    setHomeChannelSelection(
                        state.workspace.id,
                        channelMode,
                        submittedChannels,
                    );
                }
                return {
                    workspace: state.workspace,
                    enabled,
                    workspaceId: state.workspace.id,
                    ownerUserId,
                    ownerDisplayName: ownerUserId
                        ? ownerDisplayName(ownerUserId, state.availableMembers)
                        : '',
                    channelScope:
                        channelMode === 'all_accessible'
                            ? []
                            : submittedChannels.map((channel) => channel.id),
                };
            })
            .filter((target) => target.enabled);
    }

    function workspaceOwnersFromForm(form: HTMLFormElement) {
        return homeTargetsFromForm(form, false)
            .filter((target) => target.ownerUserId)
            .map((target) => ({
                workspaceId: target.workspaceId,
                ownerUserId: target.ownerUserId,
                ownerDisplayName: target.ownerDisplayName,
            }));
    }

    function workspaceChannelsFromForm(form: HTMLFormElement) {
        return homeTargetsFromForm(form, false).map((target) => {
            const state = channelStates.find(
                (entry) => entry.workspace.id === target.workspaceId,
            );
            const formData = new FormData(form);
            const channelScopeMode: 'selected' | 'all_accessible' =
                String(
                    formData.get(`channelScopeMode:${target.workspaceId}`) ??
                        state?.mode ??
                        'selected',
                ) === 'all_accessible'
                    ? 'all_accessible'
                    : 'selected';
            const selectedChannels =
                channelScopeMode === 'selected'
                    ? target.channelScope.map((channelId) => ({
                          id: channelId,
                          displayName:
                              state?.availableChannels.find(
                                  (channel) => channel.id === channelId,
                              )?.displayName ?? channelId,
                      }))
                    : [];
            return {
                workspaceId: target.workspaceId,
                channelScopeMode,
                selectedChannels,
            };
        });
    }

    app.querySelector<HTMLButtonElement>('.save-customize')?.addEventListener(
        'click',
        async (event) => {
            const form = (event.currentTarget as HTMLElement).closest(
                'form',
            ) as HTMLFormElement | null;
            if (!form) return;
            syncHomeChannelSelection();
            homeTargetsFromForm(form, true);
            const status = form.querySelector<HTMLElement>(
                '.customize-save-status',
            );
            try {
                await putJson('/api/setup/defaults', {
                    workspaceOwners: workspaceOwnersFromForm(form),
                    workspaceChannels: workspaceChannelsFromForm(form),
                });
            } catch (error) {
                if (status) {
                    status.textContent =
                        error instanceof Error ? error.message : 'Could not save';
                }
                return;
            }
            if (status) {
                status.textContent = 'Saved';
            }
        },
    );

    app.querySelector<HTMLFormElement>('#go-to-sleep-form')?.addEventListener(
        'submit',
        async (event) => {
            event.preventDefault();
            const form = event.currentTarget as HTMLFormElement;
            const formData = new FormData(form);

            const mode = String(formData.get('mode') ?? 'manual_review');
            const endTimeVal = String(
                formData.get('endTime') ??
                    `${String(userStartHour).padStart(2, '0')}:00`,
            );
            const tz = String(formData.get('timezone') ?? userTz);
            const targets = homeTargetsFromForm(form, true);

            try {
                await putJson('/api/setup/defaults', {
                    workspaceOwners: workspaceOwnersFromForm(form),
                    workspaceChannels: workspaceChannelsFromForm(form),
                });
                await postJson<SessionCreateResponse>(
                    '/api/gateway/sessions/bulk',
                    {
                        ownerUserId: currentUserId,
                        title: 'Watching overnight',
                        mode,
                        stopLocalTime: endTimeVal,
                        timezone: tz,
                        targets: targets.map((target) => ({
                            workspaceId: target.workspaceId,
                            ownerUserId: target.ownerUserId,
                            channelScope: target.channelScope,
                        })),
                    },
                );
                dashboardError = '';
                dashboardNotice =
                    targets.length > 1
                        ? `Murph is watching ${targets.map((target) => providerLabel(target.workspace.provider)).join(' and ')}.`
                        : 'Murph is watching.';
                await renderDashboard();
            } catch (error) {
                if (error instanceof ApiError) {
                    dashboardNotice = '';
                    dashboardError = sessionCreateErrorHtml(
                        error.payload as SessionCreateResponse,
                    );
                    await renderDashboard();
                } else {
                    throw error;
                }
            }
        },
    );

    app.querySelectorAll<HTMLButtonElement>('.stop-session').forEach(
        (button) => {
            button.addEventListener('click', async () => {
                await postJson(
                    `/api/gateway/sessions/${button.dataset.sessionId}/stop`,
                );
                dashboardNotice = 'Session stopped.';
                await renderDashboard();
            });
        },
    );
}

async function renderSettings(): Promise<void> {
    setTitle('Murph Admin');
    loading('Admin');

    const params = new URLSearchParams(window.location.search);
    let settingsNotice = '';
    if (params.get('error') === 'google_not_configured') {
        settingsNotice =
            '<div class="notice danger">Google OAuth is not configured. Open the Google card and add the client ID and client secret.</div>';
    } else if (params.get('error')) {
        settingsNotice = `<div class="notice danger">${escapeHtml(params.get('error'))}</div>`;
    } else if (params.get('google') === 'connected') {
        settingsNotice =
            '<div class="notice success">Google account connected.</div>';
    }
    if (settingsNotice) {
        history.replaceState(null, '', '/settings');
    }

    const [setup, policyConfig, summaryPayload] = await Promise.all([
        getJson<SetupStatusPayload>('/api/setup/status'),
        getJson<PolicyConfigPayload>('/api/gateway/policy/config'),
        getJson<SummaryPayload>('/api/gateway/summary'),
    ]);
    setSidebarWatchingCount(summaryPayload.summary.activeSessionCount);
    const workspaces = adminChannelWorkspaces(setup);
    const returnedWorkspaceId = params.get('workspaceId');
    if (
        returnedWorkspaceId &&
        workspaces.some((workspace) => workspace.id === returnedWorkspaceId)
    ) {
        localStorage.setItem(ADMIN_WORKSPACE_STORAGE_KEY, returnedWorkspaceId);
        localStorage.setItem(HOME_WORKSPACE_STORAGE_KEY, returnedWorkspaceId);
    }
    const selectedWorkspaceId = resolveAdminWorkspaceId(workspaces);
    const integrationsPayload: IntegrationStatusPayload = selectedWorkspaceId
        ? await getJson<IntegrationStatusPayload>(
              `/api/integrations/status?workspaceId=${encodeURIComponent(selectedWorkspaceId)}`,
          )
        : { ok: false, workspaceId: '', integrations: [] };
    const channelConnected = workspaces.length > 0;
    const discordRuntimeConfigured =
        setup.discord.botTokenConfigured && setup.discord.clientIdConfigured;
    const discordSetupDetail = setup.discord.installed && setup.discord.ownerConfigured === false
        ? 'Run murph setup discord'
        : discordRuntimeConfigured
            ? 'Configured by CLI'
            : 'Missing CLI settings';

    shell(`
    ${settingsNotice}
    ${sessionFeedbackHtml()}
    <section class="page-head console-head">
      <div>
        <p class="eyebrow">Setup</p>
        <h1>Admin</h1>
        <p>Connect the services Murph needs to watch messages and draft useful replies.</p>
      </div>
      ${consoleStateHtml(setup.provider.configured && channelConnected ? 'Operational' : 'Needs setup', setup.provider.configured && channelConnected ? 'ok' : 'off')}
    </section>

    <dl class="kpis">
      ${workspaceMetric(workspaces)}
      ${metric('AI provider', setup.provider.configured ? `${setup.provider.defaultProvider}` : 'Not configured')}
      ${metric('Slack', setup.slack.installed ? 'Connected' : 'Not connected')}
      ${metric('Discord', setup.discord.installed ? 'Connected' : 'Not connected')}
    </dl>

    <section class="grid three service-grid">
      <article class="panel panel-status">
        <h2><span class="status-dot ${setup.slack.installed && setup.slack.oauthConfigured ? 'ok' : 'off'}" aria-hidden="true"></span>Slack</h2>
        <p>Let Murph watch Slack channels and prepare replies while you are away.</p>
        <dl class="details">
          <div><dt>Status</dt><dd>${setup.slack.installed ? 'Connected' : 'Not connected'}</dd></div>
          <div><dt>Events</dt><dd>${setup.slack.eventsMode === 'socket' ? 'Socket Mode' : 'HTTP'}</dd></div>
          <div><dt>Setup</dt><dd>${setup.slack.oauthConfigured && setup.slack.socketConfigured ? 'Ready to install' : 'Missing app settings'}</dd></div>
        </dl>
        <div class="actions">
          ${
              setup.slack.oauthConfigured
                  ? `<a class="button" href="/api/slack/install">${setup.slack.installed ? 'Reconnect Slack' : 'Connect Slack'}</a>`
                  : '<span class="empty">Slack OAuth is not configured.</span>'
          }
        </div>
      </article>
      <article class="panel panel-status">
        <h2><span class="status-dot ${setup.discord.installed && setup.discord.botTokenConfigured ? 'ok' : 'off'}" aria-hidden="true"></span>Discord</h2>
        <p>Connect Discord if this workspace also needs async coverage there.</p>
        <dl class="details">
          <div><dt>Status</dt><dd>${setup.discord.installed ? 'Connected' : 'Not connected'}</dd></div>
          <div><dt>Setup</dt><dd>${discordSetupDetail}</dd></div>
        </dl>
        <div class="actions">
          <span class="empty">Use <code>murph setup discord</code> to connect or update Discord.</span>
        </div>
      </article>
      <article class="panel panel-status">
        <h2><span class="status-dot ${setup.provider.configured ? 'ok' : 'off'}" aria-hidden="true"></span>AI provider</h2>
        <p>Add an OpenAI or Anthropic key so Murph can draft replies.</p>
        <dl class="details">
          <div><dt>Status</dt><dd>${setup.provider.configured ? 'Connected' : 'Missing API key'}</dd></div>
          <div><dt>Default</dt><dd>${escapeHtml(setup.provider.defaultProvider)}</dd></div>
          <div><dt>Murph Agent</dt><dd>${escapeHtml(`${agentProvider(setup)} / ${agentModel(setup)}`)}</dd></div>
        </dl>
      </article>
    </section>

    <section class="policy-section">
      <article class="policy-editor-panel">
        <h2>Policy</h2>
        <div class="policy-card-content">
          <div class="policy-controls">
            <p class="section-copy">Choose the policy Murph uses for new sessions.</p>
            <form class="form compact-form" id="policy-form">
              <label>
                Policy profile
                <select name="profileName">
                  ${policyProfileOptions(policyConfig.profiles, policyConfig.policyProfileName)}
                </select>
              </label>
              <p class="policy-help">Need a custom policy? <a href="https://murph-agent.com/docs/policy" target="_blank" rel="noreferrer">Use Murph Agent to generate one</a>.</p>
              <div class="actions">
                <button type="button" class="secondary open-policy-profiles">Profiles</button>
                <button type="submit">Save policy</button>
              </div>
            </form>
          </div>
          <div class="policy-effective">
            <p class="eyebrow">Effective policy</p>
            ${policySummary(policyConfig.selectedProfileName, policyConfig.selectedProfile.description, policyConfig.compiled)}
          </div>
        </div>
      </article>
    </section>

    <section class="integration-section">
      <div class="section-head">
        <h2>Integrations</h2>
        <span class="section-meta">${integrationsPayload.integrations.length} sources</span>
      </div>
      <p class="section-copy">Connect optional sources Murph can use for grounded replies across all channel workspaces.</p>
      ${
          selectedWorkspaceId
              ? `<div class="grid two">
            ${integrationsPayload.integrations.map((i) => integrationCard(i, integrationsPayload.workspaceId)).join('')}
          </div>`
              : '<p class="empty">Connect a Slack workspace or Discord server before adding sources.</p>'
      }
    </section>

    ${githubRepositoryDialog(integrationsPayload.workspaceId)}
    ${integrationCredentialDialog(integrationsPayload.workspaceId)}
    ${googleOAuthDialog(integrationsPayload.workspaceId)}
    ${policyProfileDialog(policyConfig.profiles, policyConfig.selectedProfileName)}
  `);

    const integrationsByProvider = new Map(
        integrationsPayload.integrations.map((integration) => [
            integration.provider,
            integration,
        ]),
    );

    app.querySelector<HTMLFormElement>('#policy-form')?.addEventListener(
        'submit',
        async (event) => {
            event.preventDefault();
            const formData = new FormData(
                event.currentTarget as HTMLFormElement,
            );
            await putJson('/api/gateway/policy/config', {
                profileName: String(formData.get('profileName') ?? ''),
            });
            dashboardNotice = 'Policy saved.';
            await renderSettings();
        },
    );

    app.querySelector<HTMLButtonElement>('.open-policy-profiles')?.addEventListener(
        'click',
        () => {
            app.querySelector<HTMLDialogElement>(
                '#policy-profile-dialog',
            )?.showModal();
        },
    );

    app.querySelectorAll<HTMLButtonElement>('.close-policy-profiles').forEach(
        (button) => {
            button.addEventListener('click', () => {
                app.querySelector<HTMLDialogElement>(
                    '#policy-profile-dialog',
                )?.close();
            });
        },
    );

    async function loadGithubRepositories(): Promise<void> {
        const picker = app.querySelector<HTMLDivElement>('.github-repo-picker');
        const workspaceId =
            picker?.dataset.workspaceId ?? integrationsPayload.workspaceId;
        const listEl =
            picker?.querySelector<HTMLDivElement>('.github-repo-list');
        const saveButton =
            picker?.querySelector<HTMLButtonElement>('.save-github-repos');
        if (!picker || !listEl || !saveButton) return;

        listEl.innerHTML = '<p class="empty">Loading repositories...</p>';
        saveButton.disabled = true;
        try {
            const payload = await getJson<GitHubRepositoriesPayload>(
                `/api/integrations/github/repositories?workspaceId=${encodeURIComponent(workspaceId)}`,
            );
            if (!payload.ok) {
                listEl.innerHTML = `<p class="empty">${escapeHtml(payload.error ?? 'Could not load GitHub repositories.')}</p>`;
                return;
            }

            const selected = new Set(payload.selectedRepositories);
            listEl.innerHTML =
                payload.repositories.length > 0
                    ? `<div class="member-list">
            ${payload.repositories
                .map(
                    (repo) => `
              <label class="member-item channel-item ${selected.has(repo.fullName) ? 'selected' : ''}">
                <input type="checkbox" name="githubRepository" value="${escapeHtml(repo.fullName)}" ${selected.has(repo.fullName) ? 'checked' : ''} />
                <span class="member-avatar-placeholder">${escapeHtml(repo.owner.charAt(0).toUpperCase())}</span>
                <span class="channel-copy">
                  <strong>${escapeHtml(repo.fullName)}</strong>
                  <small>${repo.private ? 'Private' : 'Public'}</small>
                </span>
              </label>
            `,
                )
                .join('')}
          </div>`
                    : '<p class="empty">No GitHub repositories were visible to this token.</p>';

            const sync = () => {
                saveButton.disabled = false;
                listEl
                    .querySelectorAll<HTMLLabelElement>('.channel-item')
                    .forEach((item) => {
                        const input =
                            item.querySelector<HTMLInputElement>('input');
                        item.classList.toggle(
                            'selected',
                            Boolean(input?.checked),
                        );
                    });
            };
            listEl
                .querySelectorAll<HTMLInputElement>(
                    'input[name="githubRepository"]',
                )
                .forEach((input) => {
                    input.addEventListener('change', sync);
                });
        } catch (error) {
            listEl.innerHTML = `<p class="empty">${escapeHtml(error instanceof Error ? error.message : 'Could not load GitHub repositories.')}</p>`;
        }
    }

    app.querySelector<HTMLButtonElement>(
        '.manage-github-repos',
    )?.addEventListener('click', async () => {
        const dialog = app.querySelector<HTMLDialogElement>(
            '#github-repo-dialog',
        );
        dialog?.showModal();
        await loadGithubRepositories();
    });

    app.querySelectorAll<HTMLButtonElement>('.close-github-repos').forEach(
        (button) => {
            button.addEventListener('click', () => {
                app.querySelector<HTMLDialogElement>(
                    '#github-repo-dialog',
                )?.close();
            });
        },
    );

    app.querySelector<HTMLDialogElement>(
        '#github-repo-dialog',
    )?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) {
            (event.currentTarget as HTMLDialogElement).close();
        }
    });

    app.querySelectorAll<HTMLButtonElement>('.save-github-repos').forEach(
        (button) => {
            button.addEventListener('click', async () => {
                const picker = button.closest<HTMLDivElement>(
                    '.github-repo-picker',
                );
                if (!picker) {
                    return;
                }
                const workspaceId =
                    picker.dataset.workspaceId ??
                    integrationsPayload.workspaceId;
                const repositories = Array.from(
                    picker.querySelectorAll<HTMLInputElement>(
                        'input[name="githubRepository"]:checked',
                    ),
                ).map((input) => input.value);
                button.disabled = true;
                try {
                    await putJson('/api/integrations/github/repositories', {
                        workspaceId,
                        repositories,
                    });
                    dashboardNotice =
                        repositories.length > 0
                            ? 'GitHub repositories saved.'
                            : 'GitHub retrieval disabled until repositories are selected.';
                    app.querySelector<HTMLDialogElement>(
                        '#github-repo-dialog',
                    )?.close();
                    await renderSettings();
                } catch (error) {
                    window.alert(
                        error instanceof Error
                            ? error.message
                            : 'Could not save GitHub repositories.',
                    );
                    button.disabled = false;
                }
            });
        },
    );

    app.querySelectorAll<HTMLButtonElement>(
        '.close-integration-credential',
    ).forEach((button) => {
        button.addEventListener('click', () => {
            app.querySelector<HTMLDialogElement>(
                '#integration-credential-dialog',
            )?.close();
        });
    });

    app.querySelector<HTMLDialogElement>(
        '#integration-credential-dialog',
    )?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) {
            (event.currentTarget as HTMLDialogElement).close();
        }
    });

    app.querySelectorAll<HTMLButtonElement>('.connect-integration').forEach(
        (button) => {
            button.addEventListener('click', () => {
                const provider = button.dataset.provider ?? '';
                const integration = integrationsByProvider.get(provider);
                if (!integration) {
                    return;
                }
                const dialog = app.querySelector<HTMLDialogElement>(
                    '#integration-credential-dialog',
                );
                const form = app.querySelector<HTMLFormElement>(
                    '#integration-credential-form',
                );
                if (!dialog || !form) {
                    return;
                }
                const name = integration?.name ?? provider;
                form.reset();
                form.dataset.workspaceId = integrationsPayload.workspaceId;
                const providerInput = form.querySelector<HTMLInputElement>(
                    'input[name="provider"]',
                );
                const credentialInput = form.querySelector<HTMLInputElement>(
                    'input[name="credential"]',
                );
                const error = form.querySelector<HTMLElement>(
                    '#integration-credential-error',
                );
                if (providerInput) providerInput.value = provider;
                if (credentialInput) credentialInput.value = '';
                if (error) {
                    error.hidden = true;
                    error.textContent = '';
                }
                const providerEl = app.querySelector<HTMLElement>(
                    '#integration-credential-provider',
                );
                const titleEl = app.querySelector<HTMLElement>(
                    '#integration-credential-title',
                );
                const descriptionEl = app.querySelector<HTMLElement>(
                    '#integration-credential-description',
                );
                const labelEl = app.querySelector<HTMLElement>(
                    '#integration-credential-label',
                );
                const hintEl = app.querySelector<HTMLElement>(
                    '#integration-credential-hint',
                );
                if (providerEl) providerEl.textContent = name;
                if (titleEl)
                    titleEl.textContent = `${integration.status === 'connected' ? 'Update' : 'Connect'} ${name}`;
                if (descriptionEl)
                    descriptionEl.textContent = integration.description;
                if (labelEl)
                    labelEl.textContent =
                        integration.credentialLabel ?? 'API key';
                if (hintEl) {
                    hintEl.textContent = `Stored locally for Murph and available to all channel workspaces. ${integration.envKey} still works as a server env override.`;
                }
                dialog.showModal();
                credentialInput?.focus();
            });
        },
    );

    app.querySelector<HTMLFormElement>(
        '#integration-credential-form',
    )?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const formData = new FormData(form);
        const provider = String(formData.get('provider') ?? '');
        const credential = String(formData.get('credential') ?? '').trim();
        const integration = integrationsByProvider.get(provider);
        const error = form.querySelector<HTMLElement>(
            '#integration-credential-error',
        );
        const submitButton = form.querySelector<HTMLButtonElement>(
            'button[type="submit"]',
        );
        if (!integration || !credential) {
            return;
        }

        if (error) {
            error.hidden = true;
            error.textContent = '';
        }
        if (submitButton) submitButton.disabled = true;

        try {
            await postJson(
                `/api/integrations/${encodeURIComponent(provider)}/connect`,
                {
                    workspaceId:
                        form.dataset.workspaceId ??
                        integrationsPayload.workspaceId,
                    credential,
                },
            );
            dashboardNotice = `Connected ${integration.name}.`;
            app.querySelector<HTMLDialogElement>(
                '#integration-credential-dialog',
            )?.close();
            await renderSettings();
        } catch (errorValue) {
            if (error) {
                error.textContent =
                    errorValue instanceof Error
                        ? errorValue.message
                        : 'Integration could not be connected.';
                error.hidden = false;
            }
            if (submitButton) submitButton.disabled = false;
        }
    });

    app.querySelectorAll<HTMLButtonElement>('.close-google-oauth').forEach(
        (button) => {
            button.addEventListener('click', () => {
                app.querySelector<HTMLDialogElement>(
                    '#google-oauth-dialog',
                )?.close();
            });
        },
    );

    app.querySelector<HTMLDialogElement>(
        '#google-oauth-dialog',
    )?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) {
            (event.currentTarget as HTMLDialogElement).close();
        }
    });

    app.querySelectorAll<HTMLButtonElement>('.configure-google-oauth').forEach(
        (button) => {
            button.addEventListener('click', () => {
                const form =
                    app.querySelector<HTMLFormElement>('#google-oauth-form');
                const dialog = app.querySelector<HTMLDialogElement>(
                    '#google-oauth-dialog',
                );
                const error = form?.querySelector<HTMLElement>(
                    '#google-oauth-error',
                );
                if (!form || !dialog) {
                    return;
                }
                form.reset();
                form.dataset.workspaceId = integrationsPayload.workspaceId;
                form.dataset.installHref =
                    button.dataset.installHref ??
                    `/api/google/install?workspaceId=${encodeURIComponent(integrationsPayload.workspaceId)}`;
                if (error) {
                    error.hidden = true;
                    error.textContent = '';
                }
                dialog.showModal();
                form.querySelector<HTMLInputElement>(
                    'input[name="clientId"]',
                )?.focus();
            });
        },
    );

    app.querySelector<HTMLFormElement>('#google-oauth-form')?.addEventListener(
        'submit',
        async (event) => {
            event.preventDefault();
            const form = event.currentTarget as HTMLFormElement;
            const formData = new FormData(form);
            const clientId = String(formData.get('clientId') ?? '').trim();
            const clientSecret = String(
                formData.get('clientSecret') ?? '',
            ).trim();
            const error = form.querySelector<HTMLElement>(
                '#google-oauth-error',
            );
            const submitButton = form.querySelector<HTMLButtonElement>(
                'button[type="submit"]',
            );
            if (!clientId || !clientSecret) {
                return;
            }
            if (error) {
                error.hidden = true;
                error.textContent = '';
            }
            if (submitButton) submitButton.disabled = true;

            try {
                await postJson('/api/setup/config', {
                    GOOGLE_CLIENT_ID: clientId,
                    GOOGLE_CLIENT_SECRET: clientSecret,
                });
                window.location.href =
                    form.dataset.installHref ??
                    `/api/google/install?workspaceId=${encodeURIComponent(form.dataset.workspaceId ?? integrationsPayload.workspaceId)}`;
            } catch (errorValue) {
                if (error) {
                    error.textContent =
                        errorValue instanceof Error
                            ? errorValue.message
                            : 'Google OAuth settings could not be saved.';
                    error.hidden = false;
                }
                if (submitButton) submitButton.disabled = false;
            }
        },
    );

    app.querySelectorAll<HTMLButtonElement>('.disconnect-integration').forEach(
        (button) => {
            button.addEventListener('click', async () => {
                const provider = button.dataset.provider ?? '';
                const integration = integrationsByProvider.get(provider);
                const name = integration?.name ?? provider;
                const disconnectUrl =
                    integration?.authType === 'oauth'
                        ? `/api/${encodeURIComponent(provider)}/disconnect?workspaceId=${encodeURIComponent(integrationsPayload.workspaceId)}`
                        : `/api/integrations/${encodeURIComponent(provider)}/disconnect?workspaceId=${encodeURIComponent(integrationsPayload.workspaceId)}`;
                const response = await fetch(disconnectUrl, {
                    method: 'DELETE',
                });
                if (!response.ok) {
                    const payload = (await response
                        .json()
                        .catch(() => ({}))) as { error?: string };
                    window.alert(
                        payload.error ??
                            'Integration could not be disconnected.',
                    );
                    return;
                }
                dashboardNotice = `Disconnected ${name}.`;
                await renderSettings();
            });
        },
    );
}

async function renderReview(): Promise<void> {
    setTitle('Murph Review Queue');
    loading('Review Queue');
    const queuePayload = await getJson<QueuePayload>('/api/gateway/queue');

    shell(`
    <section class="page-head console-head">
      <div>
        <p class="eyebrow">Manual review</p>
        <h1>Review Queue</h1>
      </div>
      <span class="console-state">${queuePayload.queue.length} ${queuePayload.queue.length === 1 ? 'draft' : 'drafts'}</span>
    </section>

    <section class="stack review-stack">
      ${
          queuePayload.queue.length === 0
              ? '<article class="panel"><p class="empty">Queued drafts appear here whenever Murph proposes a reply under manual review. Nothing waiting right now.</p></article>'
              : queuePayload.queue
                    .map(
                        (item) => `
                  <article class="panel draft-panel">
                    <h2><span>${escapeHtml(item.channelId)}</span><code>${escapeHtml(item.threadTs)}</code></h2>
                    <p class="draft-text">${escapeHtml(item.message || 'No message drafted')}</p>
                    <dl class="details">
                      <div><dt>Session</dt><dd>${escapeHtml(item.sessionId ?? '—')}</dd></div>
                      <div><dt>Owner</dt><dd>${escapeHtml(item.targetUserId ?? 'Unknown')}</dd></div>
                      <div><dt>Action</dt><dd>${escapeHtml(titleCase(item.action))}</dd></div>
                      <div><dt>Reason</dt><dd>${escapeHtml(item.reason)}</dd></div>
                    </dl>
                    <div class="actions">
                      <button data-review-id="${escapeHtml(item.id)}" data-action="approve_send">Approve and Send</button>
                      <button class="secondary" data-review-id="${escapeHtml(item.id)}" data-action="mark_abstain">Mark Abstain</button>
                      <button class="secondary" data-review-id="${escapeHtml(item.id)}" data-action="reject">Reject</button>
                    </div>
                  </article>
                `,
                    )
                    .join('')
      }
    </section>
  `);

    app.querySelectorAll<HTMLButtonElement>('[data-review-id]').forEach(
        (button) => {
            button.addEventListener('click', async () => {
                button.disabled = true;
                await postJson(
                    `/api/gateway/queue/${button.dataset.reviewId}`,
                    {
                        action: button.dataset.action,
                    },
                );
                await renderReview();
            });
        },
    );
}

function dispositionPill(disposition: string | undefined): string {
    if (disposition === 'auto_sent')
        return '<span class="pill pill-ok">Auto-sent</span>';
    if (disposition === 'abstained')
        return '<span class="pill pill-muted">Abstained</span>';
    return `<span class="pill pill-muted">${escapeHtml(titleCase(disposition ?? 'unknown'))}</span>`;
}

function renderTriageItem(item: TriagePayload['items'][number]): string {
    const messages = item.contextSnapshot?.thread.messages ?? [];
    const excerpt = messages.at(-1)?.text ?? item.message ?? item.reason;
    const confidence =
        typeof item.confidence === 'number'
            ? `${Math.round(item.confidence * 100)}%`
            : '—';

    return `
    <article class="panel triage-item">
      <h2>${dispositionPill(item.disposition)} <span>${escapeHtml(item.channelId)}</span><code>${escapeHtml(item.threadTs)}</code></h2>
      <dl class="details">
        <div><dt>Recorded</dt><dd title="${escapeHtml(formatExactIso(item.createdAt))}">${escapeHtml(formatRelative(item.createdAt))}</dd></div>
        <div><dt>Action</dt><dd>${escapeHtml(titleCase(item.action))}</dd></div>
        <div><dt>Confidence</dt><dd>${escapeHtml(confidence)}</dd></div>
        <div><dt>Case</dt><dd>${escapeHtml(titleCase(item.contextSnapshot?.continuityCase ?? 'unknown'))}</dd></div>
        <div><dt>Thread summary</dt><dd>${escapeHtml(item.contextSnapshot?.summary ?? 'No thread snapshot was captured for this action.')}</dd></div>
        <div><dt>Thread excerpt</dt><dd>${escapeHtml(excerpt || 'No thread messages captured.')}</dd></div>
        <div><dt>Murph response</dt><dd>${escapeHtml(item.message || 'No message drafted')}</dd></div>
        <div><dt>Reason</dt><dd>${escapeHtml(item.reason)}</dd></div>
      </dl>
    </article>
  `;
}

function renderTriageSessionLink(
    session: TriagePayload['sessions'][number],
    selectedSessionId: string | undefined,
): string {
    const isSelected = session.id === selectedSessionId;
    const count = session.triageItemCount ?? 0;
    return `
    <a
      class="session-history-row ${isSelected ? 'active' : ''}"
      href="/triage?sessionId=${escapeHtml(session.id)}"
      data-link
      ${isSelected ? 'aria-current="page"' : ''}
    >
      <strong>${escapeHtml(session.title)}</strong>
      <span>${escapeHtml(sessionModeLabel(session.mode))} · ${escapeHtml(titleCase(session.status))}</span>
      <span title="${escapeHtml(formatExactIso(session.stoppedAt))}">${escapeHtml(formatRelative(session.stoppedAt))}</span>
      <small>${count} ${count === 1 ? 'action' : 'actions'}</small>
    </a>
  `;
}

async function renderTriage(): Promise<void> {
    setTitle('Murph Triage');
    loading('Triage');
    const selectedSessionId = new URLSearchParams(window.location.search).get(
        'sessionId',
    );
    const payload = await getJson<TriagePayload>(
        `/api/gateway/triage${selectedSessionId ? `?sessionId=${encodeURIComponent(selectedSessionId)}` : ''}`,
    );
    const grouped = new Map<string, TriagePayload['items']>();
    for (const item of payload.items) {
        const items = grouped.get(item.channelId) ?? [];
        items.push(item);
        grouped.set(item.channelId, items);
    }

    shell(`
    <section class="page-head console-head">
      <div>
        <p class="eyebrow">Morning catchup</p>
        <h1>Triage</h1>
        <p>${escapeHtml(
            payload.session
                ? `${payload.session.title} (${sessionModeLabel(payload.session.mode)})`
                : 'No completed sessions yet.',
        )}</p>
      </div>
      <span class="console-state">${payload.items.length} ${payload.items.length === 1 ? 'action' : 'actions'}</span>
    </section>

    <section class="triage-layout">
      <aside class="panel session-history">
        <h2>Completed sessions</h2>
        ${
            payload.sessions.length === 0
                ? '<p class="empty">Completed sleep sessions will appear here after Murph stops or expires a session.</p>'
                : `<div class="session-history-list">
                ${payload.sessions.map((session) => renderTriageSessionLink(session, payload.session?.id)).join('')}
              </div>`
        }
      </aside>

      <section class="triage-detail stack">
        ${
            payload.session
                ? `<article class="panel selected-session-summary">
                <h2>${escapeHtml(payload.session.title)}</h2>
                <dl class="details">
                  <div><dt>Mode</dt><dd>${escapeHtml(sessionModeLabel(payload.session.mode))}</dd></div>
                  <div><dt>Status</dt><dd>${escapeHtml(titleCase(payload.session.status))}</dd></div>
                  <div><dt>Stopped</dt><dd title="${escapeHtml(formatExactIso(payload.session.stoppedAt))}">${escapeHtml(formatRelative(payload.session.stoppedAt))}</dd></div>
                  <div><dt>Recorded</dt><dd>${payload.items.length} ${payload.items.length === 1 ? 'action' : 'actions'}</dd></div>
                </dl>
              </article>`
                : ''
        }

        ${
            payload.items.length === 0
                ? '<article class="panel"><p class="empty">No auto-sent or abstained actions were recorded for this session.</p></article>'
                : [...grouped.entries()]
                      .map(
                          ([channelId, items]) => `
                    <section class="stack channel-triage-group">
                      <div class="section-head">
                        <h2>${escapeHtml(channelId)}</h2>
                        <span class="section-meta">${items.length} ${items.length === 1 ? 'item' : 'items'}</span>
                      </div>
                      ${items.map(renderTriageItem).join('')}
                    </section>
                  `,
                      )
                      .join('')
        }
      </section>
    </section>
  `);
}

async function renderAudit(): Promise<void> {
    setTitle('Murph Decisions');
    loading('Decision Log');
    const [auditPayload, tracePayload] = await Promise.all([
        getJson<AuditPayload>('/api/gateway/audit'),
        getJson<TracesPayload>('/api/gateway/traces'),
    ]);

    shell(`
    <section class="page-head">
      <p class="eyebrow">Decision record</p>
      <h1>Decision Log</h1>
      <p>Policy outcomes, operator actions, and execution traces.</p>
    </section>

    <section class="panel">
      <h2>Policy Records</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Time</th><th>Session</th><th>Action</th><th>Outcome</th><th>Note</th></tr>
          </thead>
          <tbody>
            ${
                auditPayload.records.length === 0
                    ? '<tr><td colspan="5" class="empty">Policy decisions and operator outcomes appear here after any Slack-triggered run.</td></tr>'
                    : auditPayload.records
                          .map(
                              (record) => `
                        <tr>
                          <td title="${escapeHtml(formatExactIso(record.createdAt))}">${escapeHtml(formatRelative(record.createdAt))}</td>
                          <td>${escapeHtml(record.sessionId ?? '—')}</td>
                          <td>${escapeHtml(titleCase(record.action))}</td>
                          <td>${escapeHtml(titleCase(record.disposition))}</td>
                          <td>${escapeHtml(record.provider ? `${record.provider}: ${record.policyReason}` : record.policyReason)}</td>
                        </tr>
                      `,
                          )
                          .join('')
            }
          </tbody>
        </table>
      </div>
    </section>

    <section class="stack">
      <h2>Decision Traces</h2>
      ${
          tracePayload.traces.length === 0
              ? '<article class="panel"><p class="empty">Decision traces collect here as the agent runs; each is a compact projection of a run transcript.</p></article>'
              : tracePayload.traces
                    .map(
                        (trace) => `
                  <article class="panel">
                    <h3>${escapeHtml(trace.run.taskId)}</h3>
                    <dl class="details">
                      <div><dt>Session</dt><dd>${escapeHtml(trace.run.sessionId ?? '—')}</dd></div>
                      <div><dt>Status</dt><dd>${escapeHtml(titleCase(trace.run.status))}</dd></div>
                      <div><dt>Context</dt><dd>${escapeHtml(trace.contextSummary)}</dd></div>
                      <div><dt>Execution</dt><dd>${escapeHtml(trace.executionResult)}</dd></div>
                      <div><dt>Recorded</dt><dd title="${escapeHtml(formatExactIso(trace.createdAt))}">${escapeHtml(formatRelative(trace.createdAt))}</dd></div>
                    </dl>
                  </article>
                `,
                    )
                    .join('')
      }
    </section>
  `);
}

async function renderRuns(): Promise<void> {
    setTitle('Murph Runs');
    loading('Runs');
    const runsPayload = await getJson<RunsPayload>('/api/gateway/runs');
    const requestedId = new URL(window.location.href).searchParams.get('id');
    const selectedRun =
        (requestedId &&
            runsPayload.runs.find((run) => run.id === requestedId)) ||
        runsPayload.runs[0];
    const eventsPayload = selectedRun
        ? await getJson<RunEventsPayload>(
              `/api/gateway/runs/${selectedRun.id}/events`,
          )
        : { events: [] };

    shell(`
    <section class="page-head">
      <p class="eyebrow">Runtime transcript</p>
      <h1>Runs</h1>
      <p>Select a run to inspect its ordered agent events.</p>
    </section>

    <section class="grid two">
      <article class="panel">
        <h2>Recent Runs</h2>
        ${
            runsPayload.runs.length === 0
                ? '<p class="empty">Agent runs appear here once a Slack event triggers the gateway.</p>'
                : `<ul class="list">${runsPayload.runs
                      .map((run) => {
                          const isActive =
                              selectedRun && selectedRun.id === run.id;
                          return `
                    <li>
                      <a
                        class="list-row run-item ${isActive ? 'active' : ''}"
                        data-link
                        href="/runs?id=${escapeHtml(run.id)}"
                        ${isActive ? 'aria-current="true"' : ''}
                      >
                        <strong>${escapeHtml(run.taskId)}</strong>
                        <span>${escapeHtml(titleCase(run.status))} · ${escapeHtml(run.channelId)}</span>
                        <span title="${escapeHtml(formatExactIso(run.startedAt))}">${escapeHtml(formatRelative(run.startedAt))}</span>
                      </a>
                    </li>
                  `;
                      })
                      .join('')}</ul>`
        }
      </article>

      <article class="panel">
        <h2>${selectedRun ? `Events — ${escapeHtml(selectedRun.taskId)}` : 'Events'}</h2>
        ${
            !selectedRun
                ? '<p class="empty">Pick a run on the left to see the event transcript.</p>'
                : eventsPayload.events.length === 0
                  ? '<p class="empty">This run has no events yet.</p>'
                  : `<ul class="list">${eventsPayload.events
                        .map(
                            (event) => `
                      <li>
                        <div class="list-row event-row">
                          <strong>${escapeHtml(event.sequence)}. ${escapeHtml(titleCase(event.type.replace(/^agent\./, '')))}</strong>
                          <span title="${escapeHtml(formatExactIso(event.createdAt))}">${escapeHtml(formatRelative(event.createdAt))} · ${escapeHtml(event.type)}</span>
                          <pre class="event-payload">${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre>
                        </div>
                      </li>
                    `,
                        )
                        .join('')}</ul>`
        }
      </article>
    </section>
  `);
}

async function renderActivity(): Promise<void> {
    setTitle('Murph Activity');
    loading('Activity');
    const [runsPayload, auditPayload, tracePayload] = await Promise.all([
        getJson<RunsPayload>('/api/gateway/runs'),
        getJson<AuditPayload>('/api/gateway/audit'),
        getJson<TracesPayload>('/api/gateway/traces'),
    ]);

    const requestedId = new URL(window.location.href).searchParams.get('id');
    const selectedRun =
        (requestedId &&
            runsPayload.runs.find((run) => run.id === requestedId)) ||
        undefined;
    const eventsPayload = selectedRun
        ? await getJson<RunEventsPayload>(
              `/api/gateway/runs/${selectedRun.id}/events`,
          )
        : { events: [] };

    shell(`
    <section class="page-head console-head">
      <div>
        <p class="eyebrow">Activity log</p>
        <h1>Activity</h1>
        <p>Runs, decisions, and traces from Murph's operations.</p>
      </div>
      <span class="console-state">${runsPayload.runs.length} ${runsPayload.runs.length === 1 ? 'run' : 'runs'}</span>
    </section>

    <section class="grid two activity-grid">
      <article class="panel">
        <h2>Recent Runs</h2>
        ${
            runsPayload.runs.length === 0
                ? '<p class="empty">Agent runs appear here once a message triggers the gateway.</p>'
                : `<ul class="list">${runsPayload.runs
                      .map((run) => {
                          const isActive =
                              selectedRun && selectedRun.id === run.id;
                          return `
                    <li>
                      <a
                        class="list-row run-item ${isActive ? 'active' : ''}"
                        data-link
                        href="/activity?id=${escapeHtml(run.id)}"
                        ${isActive ? 'aria-current="true"' : ''}
                      >
                        <strong>${escapeHtml(run.taskId)}</strong>
                        <span>${escapeHtml(titleCase(run.status))} · ${escapeHtml(run.channelId)}</span>
                        <span title="${escapeHtml(formatExactIso(run.startedAt))}">${escapeHtml(formatRelative(run.startedAt))}</span>
                      </a>
                    </li>
                  `;
                      })
                      .join('')}</ul>`
        }
      </article>

      ${
          selectedRun
              ? `
            <article class="panel event-panel">
              <h2>Events — ${escapeHtml(selectedRun.taskId)}</h2>
              ${
                  eventsPayload.events.length === 0
                      ? '<p class="empty">This run has no events yet.</p>'
                      : `<ul class="list">${eventsPayload.events
                            .map(
                                (event) => `
                          <li>
                            <div class="list-row event-row">
                              <strong>${escapeHtml(event.sequence)}. ${escapeHtml(titleCase(event.type.replace(/^agent\./, '')))}</strong>
                              <span title="${escapeHtml(formatExactIso(event.createdAt))}">${escapeHtml(formatRelative(event.createdAt))} · ${escapeHtml(event.type)}</span>
                              <pre class="event-payload">${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre>
                            </div>
                          </li>
                        `,
                            )
                            .join('')}</ul>`
              }
            </article>
          `
              : ''
      }
    </section>

    ${selectedRun ? renderToolCallsDisclosure(eventsPayload.events) : ''}

    <section class="panel">
      <h2>Policy Decisions</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Time</th><th>Session</th><th>Action</th><th>Outcome</th><th>Note</th></tr>
          </thead>
          <tbody>
            ${
                auditPayload.records.length === 0
                    ? '<tr><td colspan="5" class="empty">Policy decisions appear here after any triggered run.</td></tr>'
                    : auditPayload.records
                          .slice(0, 20)
                          .map(
                              (record) => `
                        <tr>
                          <td title="${escapeHtml(formatExactIso(record.createdAt))}">${escapeHtml(formatRelative(record.createdAt))}</td>
                          <td>${escapeHtml(record.sessionId ?? '—')}</td>
                          <td>${escapeHtml(titleCase(record.action))}</td>
                          <td>${escapeHtml(titleCase(record.disposition))}</td>
                          <td>${escapeHtml(record.provider ? `${record.provider}: ${record.policyReason}` : record.policyReason)}</td>
                        </tr>
                      `,
                          )
                          .join('')
            }
          </tbody>
        </table>
      </div>
    </section>

    ${
        tracePayload.traces.length > 0
            ? `
          <section class="stack">
            <h2>Decision Traces</h2>
            ${tracePayload.traces
                .slice(0, 10)
                .map(
                    (trace) => `
                  <article class="panel">
                    <h3>${escapeHtml(trace.run.taskId)}</h3>
                    <dl class="details">
                      <div><dt>Session</dt><dd>${escapeHtml(trace.run.sessionId ?? '—')}</dd></div>
                      <div><dt>Status</dt><dd>${escapeHtml(titleCase(trace.run.status))}</dd></div>
                      <div><dt>Context</dt><dd>${escapeHtml(trace.contextSummary)}</dd></div>
                      <div><dt>Execution</dt><dd>${escapeHtml(trace.executionResult)}</dd></div>
                      <div><dt>Recorded</dt><dd title="${escapeHtml(formatExactIso(trace.createdAt))}">${escapeHtml(formatRelative(trace.createdAt))}</dd></div>
                    </dl>
                  </article>
                `,
                )
                .join('')}
          </section>
        `
            : ''
    }
  `);
}

async function render(): Promise<void> {
    try {
        const pathname = window.location.pathname;

        if (pathname === '/setup') {
            await renderSetup();
            return;
        }

        const setupStatus =
            await getJson<SetupStatusPayload>('/api/setup/status');
        if (
            adminChannelWorkspaces(setupStatus).length === 0 ||
            !setupStatus.userConfigured ||
            !setupStatus.channelsConfigured
        ) {
            history.replaceState(null, '', '/setup');
            await renderSetup();
            return;
        }

        if (pathname === '/admin' || pathname === '/settings') {
            await renderSettings();
        } else if (pathname === '/review') {
            await renderReview();
        } else if (pathname === '/triage') {
            await renderTriage();
        } else if (pathname === '/activity') {
            await renderActivity();
        } else if (pathname === '/runs') {
            await renderActivity();
        } else if (pathname === '/audit') {
            await renderActivity();
        } else {
            await renderDashboard();
        }
    } catch (error) {
        errorView(error);
    }
}

window.addEventListener('popstate', () => {
    void render();
});

void render();
