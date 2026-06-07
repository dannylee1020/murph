import { ApiError, getJson, postJson, putJson } from '../lib/api';
import { agentModel, agentModelFields, agentProvider } from '../lib/agent';
import { escapeHtml, setTitle } from '../lib/format';
import { providerLabel, roleDescription, roleLabel } from '../lib/labels';
import {
    getTimezoneOptions,
    policyExecutionModeLabel,
    policyProfileOptions,
    timezoneLabel,
} from './page-helpers';
import { app } from '../lib/shell';
import {
    setCurrentUser,
    setHomeChannelSelection,
    setHomeWorkspaceEnabled,
    setSelectedChannels,
} from '../lib/storage';
import {
    adminChannelWorkspaces,
    channelBadge,
    defaultOwnerForWorkspace,
} from '../lib/workspaces';
import type {
    BotRole,
    ChannelWorkspace,
    DiscordSetupPreparePayload,
    ProviderRoleSetupStatus,
    PolicyConfigPayload,
    SetupChannelsPayload,
    SetupDefaultsPayload,
    SetupDoctorPayload,
    SetupStatusPayload,
    SlackSetupPreparePayload,
} from '../lib/types';

type SetupWizardState = {
    currentStep: number;
    botRoles: BotRole[];
    selectedProviders: Array<'slack' | 'discord'>;
    selectedCoverage: CoverageKey[];
    providerOnly?: ProviderOnlySetup;
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
    slackConfigurationToken?: string;
    slackPreparation?: SlackSetupPreparePayload;
    slackPreparationKey?: string;
    discordPreparation?: DiscordSetupPreparePayload;
    discordPreparationKey?: string;
    discordRedirectConfirmed: boolean;
    errorMessage: string;
    selectedUserId: string;
    selectedUserName: string;
    channelScopeMode: 'selected' | 'all_accessible';
    selectedChannelIds: string[];
    selectedChannels: Array<{ id: string; displayName: string }>;
    timezone: string;
    workdayStartHour: number;
    workdayEndHour: number;
};

type SetupChannelProvider = 'slack' | 'discord';
type CoverageKey = `${SetupChannelProvider}:${BotRole}`;
type ProviderOnlySetup = {
    provider: SetupChannelProvider;
    role: BotRole;
};
type SetupStepKey =
    | 'ai'
    | 'coverage'
    | 'schedule'
    | 'policy'
    | 'finish'
    | `connect:${SetupChannelProvider}:${BotRole}`
    | `channels:${SetupChannelProvider}`;

const SETUP_CHANNEL_PROVIDERS: SetupChannelProvider[] = ['slack', 'discord'];
const SETUP_BOT_ROLES: BotRole[] = ['channel'];
const SETUP_QUEUE_STORAGE_KEY = 'murph_setup_queue';
const SETUP_PROVIDER_ONLY_STORAGE_KEY = 'murph_setup_provider_only';

function setupDistributionRoles(setup?: SetupStatusPayload): BotRole[] {
    return ['channel'];
}

function setupDistributionName(setup?: SetupStatusPayload): string {
    return 'Murph';
}

function setupDistributionDescription(setup?: SetupStatusPayload): string {
    return 'Team channel coverage for remote teams.';
}

let setupWizardState: SetupWizardState = {
    currentStep: 0,
    botRoles: ['channel'],
    selectedProviders: [],
    selectedCoverage: [],
    providerSelections: {},
    providerOnly: undefined,
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
    workdayEndHour: 17,
};

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
        defaults.timezone ??
        schedule?.timezone ??
        setupWizardState.timezone;
    setupWizardState.workdayStartHour =
        defaults.workdayStartHour ??
        schedule?.workdayStartHour ??
        setupWizardState.workdayStartHour;
    setupWizardState.workdayEndHour =
        defaults.workdayEndHour ??
        schedule?.workdayEndHour ??
        setupWizardState.workdayEndHour;
}

function setupErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ApiError) {
        return error.status
            ? `${error.message} (${error.status})`
            : error.message;
    }
    return error instanceof Error ? error.message : fallback;
}

function isSlackAppLevelToken(value: string | undefined): boolean {
    return Boolean(value?.trim().startsWith('xapp-'));
}

function slackAppTokenValidationMessage(fieldLabel = 'Slack app-level token'): string {
    return `${fieldLabel} must start with xapp-. Paste the Socket Mode app-level token here, not the Slack app configuration token.`;
}

function slackConfigurationTokenValidationMessage(
    value: string | undefined,
): string | undefined {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) return undefined;
    if (isSlackAppLevelToken(trimmed)) {
        return 'That looks like a Slack app-level token. Paste it in the Socket Mode app-level token step, not the Slack app configuration token step.';
    }
    if (trimmed.startsWith('xoxb-')) {
        return 'That looks like a Slack bot token. Paste a Slack app configuration token for manifest setup.';
    }
    if (trimmed.startsWith('xoxp-')) {
        return 'That looks like a Slack user token. Paste a Slack app configuration token for manifest setup.';
    }
    if (trimmed.startsWith('https://hooks.slack.com/')) {
        return 'That looks like a Slack webhook URL. Paste a Slack app configuration token for manifest setup.';
    }
    return undefined;
}

function requireSlackAppLevelToken(value: string, fieldLabel = 'Slack app-level token'): void {
    if (isSlackAppLevelToken(value)) return;
    throw new Error(slackAppTokenValidationMessage(fieldLabel));
}

function parseSetupProvider(
    value: string | null | undefined,
): SetupChannelProvider | undefined {
    return value === 'slack' || value === 'discord' ? value : undefined;
}

function parseSetupRole(value: string | null | undefined): BotRole {
    return value === 'personal' ? 'personal' : 'channel';
}

function parseSetupMode(value: string | null | undefined): BotRole[] {
    if (value === 'personal') return ['personal'];
    if (value === 'both') return ['channel', 'personal'];
    return ['channel'];
}

function validCoverageKeys(values: unknown): CoverageKey[] {
    if (!Array.isArray(values)) return [];
    return values.filter(
        (value): value is CoverageKey =>
            value === 'slack:channel' ||
            value === 'slack:personal' ||
            value === 'discord:channel' ||
            value === 'discord:personal',
    );
}

function parseProviderOnlySetup(value: unknown): ProviderOnlySetup | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const provider = parseSetupProvider(
        typeof record.provider === 'string' ? record.provider : undefined,
    );
    const role =
        record.role === 'personal' || record.role === 'channel'
            ? record.role
            : undefined;
    return provider && role ? { provider, role } : undefined;
}

function saveSetupQueue(): void {
    if (setupWizardState.selectedCoverage.length === 0) {
        sessionStorage.removeItem(SETUP_QUEUE_STORAGE_KEY);
        return;
    }
    sessionStorage.setItem(
        SETUP_QUEUE_STORAGE_KEY,
        JSON.stringify(setupWizardState.selectedCoverage),
    );
}

function saveProviderOnlySetup(): void {
    if (!setupWizardState.providerOnly) {
        sessionStorage.removeItem(SETUP_PROVIDER_ONLY_STORAGE_KEY);
        return;
    }
    sessionStorage.setItem(
        SETUP_PROVIDER_ONLY_STORAGE_KEY,
        JSON.stringify(setupWizardState.providerOnly),
    );
}

function restoreProviderOnlySetup(): void {
    if (setupWizardState.providerOnly) return;
    const raw = sessionStorage.getItem(SETUP_PROVIDER_ONLY_STORAGE_KEY);
    if (!raw) return;
    try {
        const providerOnly = parseProviderOnlySetup(JSON.parse(raw));
        if (!providerOnly) {
            sessionStorage.removeItem(SETUP_PROVIDER_ONLY_STORAGE_KEY);
            return;
        }
        setupWizardState.providerOnly = providerOnly;
        setupWizardState.selectedCoverage = [
            `${providerOnly.provider}:${providerOnly.role}` as CoverageKey,
        ];
        syncCoverageStateFromKeys();
    } catch {
        sessionStorage.removeItem(SETUP_PROVIDER_ONLY_STORAGE_KEY);
    }
}

function clearProviderOnlySetup(): void {
    setupWizardState.providerOnly = undefined;
    sessionStorage.removeItem(SETUP_PROVIDER_ONLY_STORAGE_KEY);
}

function restoreSetupQueue(): void {
    const raw = sessionStorage.getItem(SETUP_QUEUE_STORAGE_KEY);
    if (!raw || setupWizardState.selectedCoverage.length > 0) return;
    try {
        const selectedCoverage = validCoverageKeys(JSON.parse(raw));
        if (selectedCoverage.length > 0) {
            setupWizardState.selectedCoverage = selectedCoverage;
            syncCoverageStateFromKeys();
        }
    } catch {
        sessionStorage.removeItem(SETUP_QUEUE_STORAGE_KEY);
    }
}

function applySetupLaunchParams(params: URLSearchParams): boolean {
    const provider = parseSetupProvider(params.get('provider'));
    if (!provider) return false;
    const roles = parseSetupMode(params.get('mode'));
    const role = roles[0] ?? 'channel';
    setupWizardState.providerOnly = { provider, role };
    setupWizardState.selectedCoverage = [
        `${provider}:${role}` as CoverageKey,
    ];
    setupWizardState.currentStep = 0;
    syncCoverageStateFromKeys();
    saveSetupQueue();
    saveProviderOnlySetup();
    return true;
}

function setupProviderWorkspace(
    setup: SetupStatusPayload,
    provider: SetupChannelProvider,
    role?: BotRole,
): ChannelWorkspace | undefined {
    const roleWorkspace = role
        ? setup[provider].roles?.[role]?.workspace
        : undefined;
    if (roleWorkspace) return roleWorkspace;
    if (role) {
        const installation = setup.botInstallations?.find(
            (entry) => entry.provider === provider && entry.role === role,
        );
        const workspace = setup.channelWorkspaces?.find(
            (entry) => entry.id === installation?.workspaceId,
        );
        if (workspace) return workspace;
    }
    if (provider === 'slack') return setup.slack.workspace;
    return setup.discord.workspace;
}

function setupProviderOwnerConfigured(
    setup: SetupStatusPayload,
    provider: SetupChannelProvider,
    role?: BotRole,
): boolean {
    const roleStatus = role ? setup[provider].roles?.[role] : undefined;
    if (role === 'personal') {
        return Boolean(roleStatus?.representedOwnerConfigured);
    }
    if (role === 'channel' && roleStatus?.ownerConfigured !== undefined) {
        return roleStatus.ownerConfigured;
    }
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
            .filter(
                (workspace) =>
                    workspace.provider === 'slack' ||
                    workspace.provider === 'discord',
            )
            .map((workspace) => [
                workspace.id,
                workspace.provider as SetupChannelProvider,
            ]),
    );
    const fromWorkspaceChannels = (defaults.defaults.workspaceChannels ?? [])
        .map((entry) => workspaceProviders.get(entry.workspaceId))
        .filter(
            (provider): provider is SetupChannelProvider =>
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

function roleIsReady(
    setup: SetupStatusPayload,
    provider: SetupChannelProvider,
    role: BotRole,
): boolean {
    const roleStatus = setup[provider].roles?.[role];
    if (!roleStatus?.configured || !roleStatus.installed) return false;
    if (role === 'personal')
        return Boolean(roleStatus.representedOwnerConfigured);
    return setupProviderOwnerConfigured(setup, provider, 'channel');
}

function coverageSelected(
    provider: SetupChannelProvider,
    role: BotRole,
): boolean {
    return setupWizardState.selectedCoverage.includes(`${provider}:${role}`);
}

function selectedSlackRoles(): BotRole[] {
    return SETUP_BOT_ROLES.filter((role) =>
        setupWizardState.selectedCoverage.includes(`slack:${role}`),
    );
}

function syncCoverageStateFromKeys(): void {
    const providers = new Set<SetupChannelProvider>();
    const roles = new Set<BotRole>();
    for (const key of setupWizardState.selectedCoverage) {
        const [provider, role] = key.split(':') as [
            SetupChannelProvider,
            BotRole,
        ];
        providers.add(provider);
        roles.add(role);
    }
    setupWizardState.selectedProviders = Array.from(providers);
    setupWizardState.botRoles = Array.from(roles);
    if (!providers.has('slack')) {
        setupWizardState.slackConfigurationToken = undefined;
        setupWizardState.slackPreparation = undefined;
        setupWizardState.slackPreparationKey = undefined;
    }
}

function orderedSetupCoverageRows(): Array<{
    provider: SetupChannelProvider;
    role: BotRole;
}> {
    const allowedRoles: BotRole[] = setupWizardState.botRoles.length
        ? setupWizardState.botRoles
        : ['channel'];
    const selectedProviders = setupWizardState.selectedProviders.length
        ? setupWizardState.selectedProviders
        : SETUP_CHANNEL_PROVIDERS;
    const providerOrder = [
        ...selectedProviders,
        ...SETUP_CHANNEL_PROVIDERS.filter(
            (provider) => !selectedProviders.includes(provider),
        ),
    ];
    return providerOrder.flatMap((provider) =>
        allowedRoles.map((role) => ({ provider, role })),
    );
}

function coverageStatusLabel(
    setup: SetupStatusPayload,
    provider: SetupChannelProvider,
    role: BotRole,
): string {
    const roleStatus = setup[provider].roles?.[role];
    const workspace = setupProviderWorkspace(setup, provider, role);
    if (roleIsReady(setup, provider, role)) {
        return workspace ? `Connected to ${workspace.name}` : 'Connected';
    }
    if (!roleStatus?.configured) {
        return provider === 'slack'
            ? 'Needs Slack app values'
            : 'Needs Discord app values';
    }
    if (!roleStatus.installed) return 'Ready to connect';
    if (role === 'personal') return 'Needs owner reconnect';
    return 'Needs owner identity';
}

function ensureSetupProviderState(
    setup: SetupStatusPayload,
    defaults: SetupDefaultsPayload,
): void {
    const allowedRoles = setupWizardState.providerOnly
        ? [setupWizardState.providerOnly.role]
        : setupDistributionRoles(setup);
    const configuredRoles = setupWizardState.providerOnly
        ? [setupWizardState.providerOnly.role]
        : setup.botRoles?.length
        ? setup.botRoles
        : setupWizardState.botRoles;
    const selectedRoles = configuredRoles.filter((role) =>
        allowedRoles.includes(role),
    );
    setupWizardState.botRoles = selectedRoles.length
        ? selectedRoles
        : allowedRoles;
    if (setupWizardState.selectedProviders.length === 0) {
        setupWizardState.selectedProviders = inferSetupProviders(
            setup,
            defaults,
        );
        if (setupWizardState.selectedProviders.length === 0) {
            setupWizardState.selectedProviders = ['slack'];
        }
    }
    if (setupWizardState.selectedCoverage.length === 0) {
        setupWizardState.selectedCoverage =
            setupWizardState.selectedProviders.flatMap((provider) =>
                setupWizardState.botRoles.map(
                    (role) => `${provider}:${role}` as CoverageKey,
                ),
            );
    } else {
        const providersBeforeRoleFilter = Array.from(
            new Set(
                setupWizardState.selectedCoverage.map((key) => {
                    const [provider] = key.split(':') as [
                        SetupChannelProvider,
                        BotRole,
                    ];
                    return provider;
                }),
            ),
        );
        setupWizardState.selectedCoverage =
            setupWizardState.selectedCoverage.filter((key) => {
                const [, role] = key.split(':') as [
                    SetupChannelProvider,
                    BotRole,
                ];
                return allowedRoles.includes(role);
            });
        syncCoverageStateFromKeys();
        if (setupWizardState.selectedCoverage.length === 0) {
            setupWizardState.selectedProviders =
                setupWizardState.selectedProviders.length > 0
                    ? setupWizardState.selectedProviders
                    : providersBeforeRoleFilter.length > 0
                      ? providersBeforeRoleFilter
                      : inferSetupProviders(setup, defaults);
            if (setupWizardState.selectedProviders.length === 0) {
                setupWizardState.selectedProviders = ['slack'];
            }
            setupWizardState.botRoles = allowedRoles;
            setupWizardState.selectedCoverage =
                setupWizardState.selectedProviders.flatMap((provider) =>
                    setupWizardState.botRoles.map(
                        (role) => `${provider}:${role}` as CoverageKey,
                    ),
                );
            syncCoverageStateFromKeys();
        }
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
            ownerUserId: owner.id || existing?.ownerUserId || '',
            ownerDisplayName: owner.name || existing?.ownerDisplayName || '',
            channelScopeMode:
                existing?.channelScopeMode ??
                workspaceChannels?.channelScopeMode ??
                (workspace?.id === defaults.workspaceId
                    ? (defaults.defaults.channelScopeMode ?? 'selected')
                    : 'selected'),
            selectedChannels: existing?.selectedChannels.length
                ? existing.selectedChannels
                : selectedChannels,
            selectedChannelIds: existing?.selectedChannelIds.length
                ? existing.selectedChannelIds
                : selectedChannels.map((channel) => channel.id),
        };
    }
}

function setupStepKeys(setup?: SetupStatusPayload): SetupStepKey[] {
    const murphConfigSteps: SetupStepKey[] = [
        ...(setup?.murphConfig?.scheduleConfigured === false
            ? (['schedule'] as const)
            : []),
        ...(setup?.murphConfig?.policyConfigured === false
            ? (['policy'] as const)
            : []),
    ];
    if (setupWizardState.providerOnly) {
        const { provider, role } = setupWizardState.providerOnly;
        return [
            `connect:${provider}:${role}`,
            ...(role === 'channel' ? [`channels:${provider}` as const] : []),
            ...murphConfigSteps,
            'finish',
        ];
    }
    return [
        'ai',
        'coverage',
        ...orderedSetupCoverageRows().flatMap(({ provider, role }) => {
            if (!coverageSelected(provider, role)) return [];
            return [
                ...(!setup || !roleIsReady(setup, provider, role)
                    ? [`connect:${provider}:${role}` as const]
                    : []),
                ...(role === 'channel'
                    ? [`channels:${provider}` as const]
                    : []),
            ];
        }),
        ...murphConfigSteps,
        'finish',
    ];
}

function setupStepLabel(stepKey: SetupStepKey): string {
    if (stepKey === 'ai') return 'AI model';
    if (stepKey === 'coverage') return 'Channel and mode';
    if (stepKey === 'schedule') return 'Schedule';
    if (stepKey === 'policy') return 'Policy';
    if (stepKey === 'finish') return 'Finish setup';
    const split = splitSetupStep(stepKey);
    if (split.provider && split.role) {
        return `${providerLabel(split.provider)} ${roleLabel(split.role)}`;
    }
    if (split.provider) return `${providerLabel(split.provider)} channels`;
    return 'Setup';
}

function setupStepProgress(
    stepKeys: SetupStepKey[],
    currentStep: number,
): string {
    return stepKeys
        .map((stepKey, index) => {
            const state =
                index < currentStep
                    ? 'completed'
                    : index === currentStep
                      ? 'active'
                      : 'pending';
            return `
              <span class="wizard-progress-segment ${state}" title="${escapeHtml(setupStepLabel(stepKey))}">
                <span>${String(index + 1).padStart(2, '0')}</span>
              </span>
            `;
        })
        .join('');
}

function setupSelectedQueuePreview(): string {
    if (setupWizardState.selectedCoverage.length === 0) return '';
    return `
      <div class="setup-queue-preview">
        <span>Setup queue</span>
        <div>
          ${setupWizardState.selectedCoverage
              .map((key) => {
                  const [provider, role] = key.split(':') as [
                      SetupChannelProvider,
                      BotRole,
                  ];
                  return `<strong>${escapeHtml(providerLabel(provider))} ${escapeHtml(roleLabel(role))}</strong>`;
              })
              .join('')}
        </div>
      </div>
    `;
}

function scheduleTimezoneOptions(selectedTimezone: string): string {
    const options = Array.from(
        new Set([selectedTimezone, ...getTimezoneOptions()].filter(Boolean)),
    );
    return options
        .map(
            (tz) =>
                `<option value="${escapeHtml(tz)}" ${tz === selectedTimezone ? 'selected' : ''}>${escapeHtml(timezoneLabel(tz))}</option>`,
        )
        .join('');
}

function nextSetupStepAfterPair(
    provider: SetupChannelProvider,
    role: BotRole,
    stepKeys: SetupStepKey[],
): number {
    if (role === 'channel') {
        const channelIndex = stepKeys.indexOf(`channels:${provider}`);
        if (channelIndex >= 0) return channelIndex;
    }

    let afterCurrentPair = false;
    for (const row of orderedSetupCoverageRows()) {
        if (!coverageSelected(row.provider, row.role)) continue;
        if (afterCurrentPair) {
            const connectIndex = stepKeys.indexOf(
                `connect:${row.provider}:${row.role}`,
            );
            if (connectIndex >= 0) return connectIndex;
            if (row.role === 'channel') {
                const channelIndex = stepKeys.indexOf(
                    `channels:${row.provider}`,
                );
                if (channelIndex >= 0) return channelIndex;
            }
        }
        if (row.provider === provider && row.role === role) {
            afterCurrentPair = true;
        }
    }

    for (const nextKey of ['schedule', 'policy', 'finish'] as const) {
        const index = stepKeys.indexOf(nextKey);
        if (index >= 0) return index;
    }
    return Math.max(0, stepKeys.length - 1);
}

function advanceSetupStep(
    renderedStepKeys: SetupStepKey[],
    renderedStepIndex: number,
    renderedStepKey: SetupStepKey,
    setup?: SetupStatusPayload,
): void {
    const nextStepKeys = setupStepKeys(setup);
    if (renderedStepKey === 'coverage') {
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

function splitSetupStep(stepKey: SetupStepKey): {
    kind: SetupStepKey;
    provider?: SetupChannelProvider;
    role?: BotRole;
} {
    if (stepKey.startsWith('connect:')) {
        const [, provider, role] = stepKey.split(':');
        return {
            kind: 'connect:slack:channel',
            provider: provider as SetupChannelProvider,
            role: role === 'personal' ? 'personal' : 'channel',
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
    return (
        setupWizardState.selectedProviders.find((provider) =>
            coverageSelected(provider, 'channel'),
        ) ??
        setupWizardState.selectedProviders[0] ??
        'slack'
    );
}

function selectedWorkspaceChannelsPayload() {
    return setupWizardState.selectedProviders
        .filter((provider) => coverageSelected(provider, 'channel'))
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

function selectedWorkspaceOwnersPayload(
    defaults?: SetupDefaultsPayload['defaults'],
) {
    const owners = new Map<
        string,
        { workspaceId: string; ownerUserId: string; ownerDisplayName: string }
    >();
    for (const owner of defaults?.workspaceOwners ?? []) {
        if (!owner.workspaceId || !owner.ownerUserId) continue;
        owners.set(owner.workspaceId, {
            workspaceId: owner.workspaceId,
            ownerUserId: owner.ownerUserId,
            ownerDisplayName: owner.ownerDisplayName || owner.ownerUserId,
        });
    }
    for (const provider of setupWizardState.selectedProviders) {
        const selection = setupWizardState.providerSelections[provider];
        if (!selection?.workspaceId || !selection.ownerUserId) continue;
        owners.set(selection.workspaceId, {
            workspaceId: selection.workspaceId,
            ownerUserId: selection.ownerUserId,
            ownerDisplayName:
                selection.ownerDisplayName || selection.ownerUserId,
        });
    }
    return Array.from(owners.values());
}


type SetupGuideRow = {
    label: string;
    value: string;
    status?: 'ok' | 'warning' | 'action';
};

type SetupGuideAction = {
    label: string;
    url?: string;
    primary?: boolean;
};

function setupStateLabel(
    value: boolean,
    okLabel: string,
    missingLabel: string,
): string {
    return value ? okLabel : missingLabel;
}

function setupGuideStatusLine(rows: SetupGuideRow[]): string {
    return rows
        .map(
            (row) => `
          <span class="setup-status-item ${escapeHtml(row.status ?? 'action')}">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.value)}</strong>
          </span>
        `,
        )
        .join('');
}

function setupGuideActions(actions: SetupGuideAction[]): string {
    const visible = actions.filter((action) => action.url);
    if (visible.length === 0) return '';
    return `
      <div class="setup-advanced-section">
        <h2>Provider links</h2>
        <div class="setup-link-grid">
          ${visible
              .map(
                  (action) => `
            <a class="setup-link ${action.primary ? 'primary' : ''}" href="${escapeHtml(action.url!)}" target="_blank" rel="noreferrer">
              <span>${escapeHtml(action.label)}</span>
              <strong>${escapeHtml(action.url!)}</strong>
            </a>
          `,
              )
              .join('')}
        </div>
      </div>
    `;
}

function setupGuideValues(values: SetupGuideRow[]): string {
    if (values.length === 0) return '';
    return `
      <div class="setup-advanced-section">
        <h2>Values</h2>
        <div class="setup-value-list">
          ${values
              .map(
                  (row) => `
            <div class="setup-value-row">
              <span>${escapeHtml(row.label)}</span>
              <code>${escapeHtml(row.value)}</code>
            </div>
          `,
              )
              .join('')}
        </div>
      </div>
    `;
}

function setupGuide(input: {
    nextAction: string;
    stateRows: SetupGuideRow[];
    actions?: SetupGuideAction[];
    values?: SetupGuideRow[];
}): string {
    const advanced = `${setupGuideActions(input.actions ?? [])}${setupGuideValues(input.values ?? [])}`;
    return `
      <div class="setup-task">
        <p>${escapeHtml(input.nextAction)}</p>
        <div class="setup-status-line">
          ${setupGuideStatusLine(input.stateRows)}
        </div>
      </div>
      ${
          advanced
              ? `<details class="setup-advanced">
                   <summary>Advanced setup details</summary>
                   ${advanced}
                 </details>`
              : ''
      }
    `;
}

function slackRoleConfigKeys(role: BotRole): string {
    const prefix = role === 'personal' ? 'SLACK_PERSONAL' : 'SLACK_CHANNEL';
    return `${prefix}_APP_TOKEN, ${prefix}_CLIENT_ID, ${prefix}_CLIENT_SECRET`;
}

function slackConnectGuide(input: {
    role: BotRole;
    roleStatus?: ProviderRoleSetupStatus;
    connected: boolean;
    ownerMissing: boolean;
}): string {
    const links = input.roleStatus?.links;
    const configured = Boolean(input.roleStatus?.configured);
    const installed = Boolean(input.roleStatus?.installed);
    const ownerKnown =
        input.role === 'personal'
            ? Boolean(input.roleStatus?.representedOwnerConfigured)
            : Boolean(input.roleStatus?.ownerConfigured);
    const nextAction = !configured
        ? input.roleStatus?.oauthConfigured
            ? 'Create or copy the app-level Socket Mode token, then paste it below.'
            : 'Create a new Slack app from the manifest, or open the reuse section to enter credentials from an existing app.'
        : !installed
          ? 'Install this Slack bot identity into the workspace from the button below.'
          : input.ownerMissing
            ? 'Reconnect Slack from this setup flow so Murph can record the OAuth owner.'
            : 'This Slack bot identity is ready. Continue to the next setup step.';

    return setupGuide({
        nextAction,
        stateRows: [
            {
                label: 'App values',
                value: setupStateLabel(configured, 'Saved', 'Missing'),
                status: configured ? 'ok' : 'action',
            },
            {
                label: 'Bot install',
                value: setupStateLabel(installed, 'Connected', 'Not connected'),
                status: installed ? 'ok' : 'action',
            },
            {
                label: 'Commands',
                value: input.role === 'channel' ? 'Socket Mode' : 'Not needed',
                status: 'ok',
            },
            {
                label: 'Owner identity',
                value: setupStateLabel(ownerKnown, 'Known', 'Needs OAuth'),
                status: ownerKnown ? 'ok' : 'action',
            },
        ],
        actions: [
            {
                label: links?.oauthConfigUrl
                    ? 'Slack app settings'
                    : 'Create Slack app',
                url: links?.oauthConfigUrl
                    ? links?.appConfigUrl
                    : links?.createAppUrl,
                primary: !configured,
            },
            { label: 'Manifest', url: links?.manifestUrl },
            { label: 'OAuth and scopes', url: links?.oauthConfigUrl },
            { label: 'Event subscriptions', url: links?.eventsConfigUrl },
        ],
        values: [
            ...(links?.callbackUrl
                ? [{ label: 'OAuth redirect URL', value: links.callbackUrl }]
                : []),
            { label: 'Config fields', value: slackRoleConfigKeys(input.role) },
        ],
    });
}

function discordRoleConfigKeys(role: BotRole): string {
    const prefix = role === 'personal' ? 'DISCORD_PERSONAL' : 'DISCORD_CHANNEL';
    return `${prefix}_BOT_TOKEN, ${prefix}_CLIENT_SECRET`;
}

function discordVisibleSetupValues(
    redirectUri?: string,
    interactionsUrl?: string,
    role: BotRole = 'channel',
): string {
    const values = [
        ...(redirectUri
            ? [{ label: 'OAuth redirect URI', value: redirectUri }]
            : []),
        ...(role === 'channel' && interactionsUrl
            ? [{ label: 'Interactions URL', value: interactionsUrl }]
            : []),
    ];
    if (values.length === 0) return '';
    return `
      <div class="setup-visible-values">
        <div class="setup-value-list">
          ${values
              .map(
                  (row) => `
            <div class="setup-value-row">
              <span>${escapeHtml(row.label)}</span>
              <code>${escapeHtml(row.value)}</code>
            </div>
          `,
              )
              .join('')}
        </div>
      </div>
    `;
}

function discordConnectGuide(input: {
    role: BotRole;
    roleStatus?: ProviderRoleSetupStatus;
    prepared?: DiscordSetupPreparePayload;
    ownerMissing: boolean;
    interactionsUrl?: string;
}): string {
    const links = input.roleStatus?.links;
    const configured = Boolean(input.roleStatus?.configured);
    const installed = Boolean(input.roleStatus?.installed);
    const ownerKnown =
        input.role === 'personal'
            ? Boolean(input.roleStatus?.representedOwnerConfigured)
            : Boolean(input.roleStatus?.ownerConfigured);
    const redirectUri = input.prepared?.redirectUri ?? links?.redirectUri;
    const nextAction = !configured
        ? 'Open the Discord application, confirm the redirect URI and bot intent, then paste the bot token and client secret.'
        : input.prepared && input.prepared.redirectUriRegistered === false
          ? 'Add the redirect URI in Discord OAuth2 settings, save the app, then re-check the redirect URI.'
          : input.prepared && input.prepared.redirectUriRegistered === undefined
            ? 'Confirm the redirect URI is saved in Discord before authorizing Murph.'
            : !installed
              ? 'Authorize this Discord bot from the button below.'
              : input.ownerMissing
                ? 'Reconnect Discord from this setup flow so Murph can record the OAuth owner.'
                : 'This Discord bot identity is ready. Continue to the next setup step.';

    return setupGuide({
        nextAction,
        stateRows: [
            {
                label: 'App values',
                value: setupStateLabel(configured, 'Saved', 'Missing'),
                status: configured ? 'ok' : 'action',
            },
            {
                label: 'Bot install',
                value: setupStateLabel(installed, 'Connected', 'Not connected'),
                status: installed ? 'ok' : 'action',
            },
            {
                label: 'Owner identity',
                value: setupStateLabel(ownerKnown, 'Known', 'Needs OAuth'),
                status: ownerKnown ? 'ok' : 'action',
            },
        ],
        actions: [
            {
                label: 'Discord OAuth2 settings',
                url:
                    input.prepared?.developerPortalUrl ??
                    links?.developerPortalUrl,
                primary: !configured || Boolean(input.prepared),
            },
            { label: 'Discord bot settings', url: links?.botConfigUrl },
        ],
        values: [
            {
                label: 'Config fields',
                value: discordRoleConfigKeys(input.role),
            },
        ],
    }) +
        (input.prepared
            ? ''
            : discordVisibleSetupValues(
                  redirectUri,
                  input.interactionsUrl,
                  input.role,
              ));
}

function slackPreparationDetails(
    preparation: SlackSetupPreparePayload,
): string {
    const action = preparation.updatedExistingApp ? 'updated' : 'created';
    return `
      <div class="setup-success">Slack app ${escapeHtml(action)}: ${escapeHtml(preparation.appId ?? preparation.clientId ?? preparation.role)}</div>
      <details class="setup-advanced">
        <summary>Slack app details</summary>
        <div class="setup-value-list">
          ${
              preparation.appId
                  ? `<div class="setup-value-row"><span>App ID</span><code>${escapeHtml(preparation.appId)}</code></div>`
                  : ''
          }
          <div class="setup-value-row"><span>OAuth redirect URL</span><code>${escapeHtml(preparation.callbackUrl)}</code></div>
        </div>
      </details>
    `;
}

function slackAppTokenForm(role: BotRole): string {
    const prefix = role === 'personal' ? 'SLACK_PERSONAL' : 'SLACK_CHANNEL';
    return `
      <form class="form" id="slack-app-token-form">
        <label>
          <span>${prefix}_APP_TOKEN</span>
          <input type="password" name="appToken" placeholder="xapp-..." autocomplete="off" required />
        </label>
      </form>
    `;
}

function slackManifestForm(reusingToken: boolean): string {
    return `
      <form class="form" id="slack-manifest-form">
        ${
            reusingToken
                ? '<div class="setup-success">Using the Slack app configuration token from the previous Slack app step</div>'
                : `<label>
                     <span>Slack app configuration token</span>
                     <input type="password" name="configurationToken" autocomplete="off" required />
                   </label>`
        }
      </form>
    `;
}

function slackManualConfigForm(role: BotRole, existingAppId?: string): string {
    const prefix = role === 'personal' ? 'SLACK_PERSONAL' : 'SLACK_CHANNEL';
    return `
      <details class="setup-advanced setup-manual-config">
        <summary>Reuse an existing Slack app</summary>
        <form class="form" id="slack-config-form">
          <label>
            <span>${prefix}_APP_ID</span>
            <input name="appId" placeholder="A0123456789" autocomplete="off" value="${escapeHtml(existingAppId ?? '')}" required />
          </label>
          <label>
            <span>${prefix}_APP_TOKEN</span>
            <input type="password" name="appToken" placeholder="xapp-..." autocomplete="off" required />
          </label>
          <label>
            <span>${prefix}_CLIENT_ID</span>
            <input name="clientId" autocomplete="off" required />
          </label>
          <label>
            <span>${prefix}_CLIENT_SECRET</span>
            <input type="password" name="clientSecret" autocomplete="off" required />
          </label>
          <label>
            <span>${prefix}_SIGNING_SECRET</span>
            <input type="password" name="signingSecret" autocomplete="off" />
          </label>
          <button type="button" class="secondary" id="slack-manual-save">Use existing Slack app</button>
        </form>
      </details>
    `;
}

function slackManualConfigPayload(
    form: HTMLFormElement | null,
    role: BotRole,
): Record<string, string> | undefined {
    const formData = form ? new FormData(form) : new FormData();
    const appId = String(formData.get('appId') ?? '').trim();
    const appToken = String(formData.get('appToken') ?? '').trim();
    const clientId = String(formData.get('clientId') ?? '').trim();
    const clientSecret = String(formData.get('clientSecret') ?? '').trim();
    const signingSecret = String(formData.get('signingSecret') ?? '').trim();
    if (!appId || !appToken || !clientId || !clientSecret) return undefined;
    requireSlackAppLevelToken(appToken, `${role === 'personal' ? 'SLACK_PERSONAL_APP_TOKEN' : 'SLACK_CHANNEL_APP_TOKEN'}`);

    return {
        SLACK_EVENTS_MODE: 'socket',
        ...(role === 'personal'
            ? {
                  SLACK_PERSONAL_APP_ID: appId,
                  SLACK_PERSONAL_APP_TOKEN: appToken,
                  SLACK_PERSONAL_CLIENT_ID: clientId,
                  SLACK_PERSONAL_CLIENT_SECRET: clientSecret,
                  ...(signingSecret
                      ? { SLACK_PERSONAL_SIGNING_SECRET: signingSecret }
                      : {}),
              }
            : {
                  SLACK_CHANNEL_APP_ID: appId,
                  SLACK_CHANNEL_APP_TOKEN: appToken,
                  SLACK_CHANNEL_CLIENT_ID: clientId,
                  SLACK_CHANNEL_CLIENT_SECRET: clientSecret,
                  ...(signingSecret
                      ? { SLACK_CHANNEL_SIGNING_SECRET: signingSecret }
                      : {}),
                  SLACK_APP_ID: appId,
                  SLACK_APP_TOKEN: appToken,
                  SLACK_CLIENT_ID: clientId,
                  SLACK_CLIENT_SECRET: clientSecret,
              }),
    };
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
    const commandNotice =
        preparation.commandsConfigured === false
            ? '<div class="notice"><strong>Discord DM shortcut commands were not registered automatically.</strong><p>Open Developer Portal and add the Murph commands manually if the shortcut is needed.</p></div>'
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
      ${discordVisibleSetupValues(preparation.redirectUri)}
      ${redirectNotice}
      ${configurationNotice}
      ${intentNotice}
      ${commandNotice}
      ${confirmation}
    `;
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


export async function renderSetup(onComplete: () => Promise<void>): Promise<void> {
    setTitle('Murph Setup');
    const params = new URLSearchParams(window.location.search);
    let setupNotice = '';
    const returnedStep = params.get('step');
    const returnedProvider = parseSetupProvider(returnedStep);
    const returnedRole = parseSetupRole(params.get('role'));
    const launchedFromAdmin = applySetupLaunchParams(params);
    if (!launchedFromAdmin) {
        if (returnedProvider) {
            restoreProviderOnlySetup();
        }
        if (!setupWizardState.providerOnly) {
            restoreSetupQueue();
        }
    }
    const slackCliReturn =
        returnedStep === 'slack' && params.get('source') === 'cli';
    if (
        returnedStep === 'slack' &&
        params.get('success') === '1' &&
        !slackCliReturn
    ) {
        if (!coverageSelected('slack', returnedRole)) {
            setupWizardState.selectedCoverage = [
                ...setupWizardState.selectedCoverage,
                `slack:${returnedRole}` as CoverageKey,
            ];
            syncCoverageStateFromKeys();
        }
        saveSetupQueue();
        saveProviderOnlySetup();
        history.replaceState(null, '', '/setup');
    } else if (returnedStep === 'discord' && params.get('success') === '1') {
        setupNotice = `<div class="setup-success">Discord ${escapeHtml(returnedRole)} bot connected</div>`;
        if (!coverageSelected('discord', returnedRole)) {
            setupWizardState.selectedCoverage = [
                ...setupWizardState.selectedCoverage,
                `discord:${returnedRole}` as CoverageKey,
            ];
            syncCoverageStateFromKeys();
        }
        saveSetupQueue();
        saveProviderOnlySetup();
        history.replaceState(null, '', '/setup');
    } else if (params.get('error')) {
        const provider =
            returnedStep === 'discord'
                ? 'Discord'
                : returnedStep === 'slack'
                  ? 'Slack'
                  : 'Setup';
        const reason =
            params.get('reason') || params.get('error') || 'Setup failed.';
        setupNotice = `<div class="notice danger">${provider} ${escapeHtml(returnedRole)} bot setup failed: ${escapeHtml(reason)}</div>`;
        if (returnedProvider && !coverageSelected(returnedProvider, returnedRole)) {
            setupWizardState.selectedCoverage = [
                ...setupWizardState.selectedCoverage,
                `${returnedProvider}:${returnedRole}` as CoverageKey,
            ];
            syncCoverageStateFromKeys();
            saveSetupQueue();
            saveProviderOnlySetup();
        }
        history.replaceState(null, '', '/setup');
    } else if (launchedFromAdmin) {
        history.replaceState(null, '', '/setup');
    }

    let setup: SetupStatusPayload;
    let doctor: SetupDoctorPayload;
    let defaults: SetupDefaultsPayload;
    let policyConfig: PolicyConfigPayload;
    try {
        [setup, doctor, defaults, policyConfig] = await Promise.all([
            getJson<SetupStatusPayload>('/api/setup/status'),
            getJson<SetupDoctorPayload>('/api/setup/doctor'),
            getJson<SetupDefaultsPayload>('/api/setup/defaults'),
            getJson<PolicyConfigPayload>('/api/gateway/policy/config'),
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
        app.querySelector<HTMLButtonElement>('#setup-retry')?.addEventListener(
            'click',
            () => {
                void renderSetup(onComplete);
            },
        );
        return;
    }
    applySetupDefaults(defaults);
    setupWizardState.timezone =
        setup.murphConfig?.timezone ?? setupWizardState.timezone;
    setupWizardState.workdayStartHour =
        setup.murphConfig?.workdayStartHour ??
        setupWizardState.workdayStartHour;
    setupWizardState.workdayEndHour =
        setup.murphConfig?.workdayEndHour ?? setupWizardState.workdayEndHour;
    ensureSetupProviderState(setup, defaults);

    if (
        returnedStep === 'slack' &&
        params.get('success') === '1' &&
        !slackCliReturn
    ) {
        const roleStatus = setup.slack.roles?.[returnedRole];
        const workspace = setupProviderWorkspace(setup, 'slack', returnedRole);
        setupNotice =
            roleStatus?.installed && workspace
                ? `<div class="setup-success">Slack ${escapeHtml(returnedRole)} bot connected</div>`
                : '<div class="notice danger">Slack OAuth completed, but Murph could not read the saved Slack workspace. Reconnect Slack from this setup flow.</div>';
    }

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

    const stepKeys = setupStepKeys(setup);
    if (returnedProvider && params.get('success') === '1') {
        setupWizardState.currentStep = nextSetupStepAfterPair(
            returnedProvider,
            returnedRole,
            stepKeys,
        );
    } else if (returnedProvider && params.get('error')) {
        const connectIndex = stepKeys.indexOf(
            `connect:${returnedProvider}:${returnedRole}`,
        );
        if (connectIndex >= 0) setupWizardState.currentStep = connectIndex;
    }
    if (setupWizardState.currentStep >= stepKeys.length) {
        setupWizardState.currentStep = stepKeys.length - 1;
    }
    const step = setupWizardState.currentStep;
    const stepKey = stepKeys[step] ?? 'ai';
    const splitStep = splitSetupStep(stepKey);
    const stepProvider = splitStep.provider;
    const stepRole = splitStep.role;
    const visibleStep = step + 1;
    const totalSteps = stepKeys.length;

    const progressSegments = setupStepProgress(stepKeys, step);
    const currentStepLabel = setupStepLabel(stepKey);
    const topbarHref = '/admin';
    const topbarLabel = 'Admin';

    let stepContent = '';

    if (stepKey === 'ai') {
        stepContent = `
      <div class="wizard-step">
        <h1>Configure AI model</h1>
        <p>Add the model Murph uses to draft replies and run <code>murph agent</code>.</p>
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
    } else if (stepKey === 'coverage') {
        const allowedRoles = setupDistributionRoles(setup);
        const distributionName = setupDistributionName(setup);
        const selectedRoles = new Set(
            allowedRoles.filter((role) =>
                setupWizardState.selectedCoverage.some((key) =>
                    key.endsWith(`:${role}`),
                ),
            ),
        );
        const selectedProviders = new Set(
            SETUP_CHANNEL_PROVIDERS.filter((provider) =>
                setupWizardState.selectedCoverage.some((key) =>
                    key.startsWith(`${provider}:`),
                ),
            ),
        );
        const roleCards = allowedRoles.map((role) => {
            const checked = selectedRoles.has(role);
            return `
          <label class="member-item channel-item ${checked ? 'selected' : ''}">
            <input type="checkbox" name="setupRole" value="${role}" ${checked ? 'checked' : ''} disabled />
            <span class="member-avatar-placeholder">${role === 'channel' ? '#' : '@'}</span>
            <span class="channel-copy">
              <strong>${escapeHtml(roleLabel(role))}</strong>
              <small>${escapeHtml(roleDescription(role))}</small>
            </span>
          </label>
        `;
        }).join('');
        const providerOptions = SETUP_CHANNEL_PROVIDERS.map((provider) => {
            const checked = selectedProviders.has(provider);
            const providerRows = allowedRoles.filter((role) =>
                coverageSelected(provider, role),
            )
                .map((role) => coverageStatusLabel(setup, provider, role))
                .join(' · ');
            return `
          <label class="member-item channel-item ${checked ? 'selected' : ''}">
            <input type="checkbox" name="setupProvider" value="${provider}" ${checked ? 'checked' : ''} />
            <span class="member-avatar-placeholder">${provider === 'slack' ? 'S' : 'D'}</span>
            <span class="channel-copy">
              <strong>${escapeHtml(providerLabel(provider))}</strong>
              <small>${escapeHtml(providerRows || 'Available for selected bots')}</small>
            </span>
          </label>
        `;
        }).join('');
        stepContent = `
      <div class="wizard-step">
        <h1>Choose provider</h1>
        <p>${escapeHtml(distributionName)} is fixed to ${escapeHtml(setupDistributionDescription(setup))}</p>
        <div class="member-list provider-list">${providerOptions}</div>
        <h2 class="setup-subhead">Coverage</h2>
        <div class="member-list setup-role-list">${roleCards}</div>
        ${setupSelectedQueuePreview()}
        <div class="wizard-actions">
          <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
          <button type="button" id="wizard-next" ${setupWizardState.selectedCoverage.length === 0 ? 'disabled' : ''}>Continue</button>
        </div>
      </div>
    `;
    } else if (stepProvider && stepKey.startsWith('connect:')) {
        if (stepProvider === 'slack') {
            const role = stepRole ?? 'channel';
            const roleStatus = setup.slack.roles?.[role];
            const slackConfigured = Boolean(roleStatus?.configured);
            const slackOauthConfigured = Boolean(roleStatus?.oauthConfigured);
            const slackSocketConfigured = Boolean(roleStatus?.socketConfigured);
            const slackInstalled = Boolean(roleStatus?.installed);
            const preparationKey = `${stepProvider}:${role}`;
            const prepared =
                setupWizardState.slackPreparationKey === preparationKey
                    ? setupWizardState.slackPreparation
                    : undefined;
            const slackOwnerMissing =
                role === 'channel'
                    ? slackInstalled &&
                      !setupProviderOwnerConfigured(setup, 'slack', role)
                    : slackInstalled &&
                      !setupProviderOwnerConfigured(setup, 'slack', role);
            const slackConnected = slackInstalled && !slackOwnerMissing;
            const needsAppToken =
                slackOauthConfigured &&
                !slackSocketConfigured &&
                !slackConfigured;
            const canReuseConfigurationToken =
                Boolean(setupWizardState.slackConfigurationToken) &&
                !slackOauthConfigured;
            const savedSlackAppId = roleStatus?.links?.appId;
            const providerOnlyReconnect =
                setupWizardState.providerOnly?.provider === stepProvider &&
                setupWizardState.providerOnly.role === role &&
                slackInstalled;
            stepContent = `
      <div class="wizard-step">
        <h1>Set up Slack ${escapeHtml(roleLabel(role).toLowerCase())}</h1>
        <p>${
            role === 'personal'
                ? 'This app handles direct messages for the represented owner.'
                : 'This app watches the channels you choose during active sessions.'
        }</p>
        ${slackConnectGuide({ role, roleStatus, connected: slackConnected, ownerMissing: slackOwnerMissing })}
        ${
            slackConfigured
                ? `<div class="setup-success">Slack ${role} app config is ready</div>`
                : needsAppToken || prepared
                  ? `${prepared ? slackPreparationDetails(prepared) : ''}
                     ${slackAppTokenForm(role)}`
                  : `${slackManifestForm(canReuseConfigurationToken)}
                     ${slackManualConfigForm(role, savedSlackAppId)}`
        }
        ${slackConnected ? `<div class="setup-success">Slack ${role} bot connected</div>` : ''}
        ${
            slackOwnerMissing
                ? '<div class="notice danger">Slack is connected, but Murph does not know the OAuth owner for this role yet. Reconnect Slack from this setup flow.</div>'
                : ''
        }
        <div class="wizard-actions">
          <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
          ${
              slackOwnerMissing
	                  ? `<a class="button" href="/api/slack/${role}/install?source=setup">Reconnect Slack</a>`
	                  : providerOnlyReconnect
	                    ? `<a class="button" href="/api/slack/${role}/install?source=setup">Reconnect Slack ${role} bot</a>`
	                  : slackInstalled
	                    ? '<button type="button" id="wizard-next">Continue</button>'
	                    : slackConfigured
	                      ? `<a class="button" href="/api/slack/${role}/install?source=setup">Connect Slack ${role} bot</a>`
	                      : needsAppToken || prepared
	                        ? '<button type="button" id="wizard-next">Save app-level token</button>'
	                        : '<button type="button" id="wizard-next">Create Slack app</button>'
	          }
        </div>
      </div>
    `;
        } else {
            const role = stepRole ?? 'channel';
            const rolePrefix =
                role === 'personal' ? 'DISCORD_PERSONAL' : 'DISCORD_CHANNEL';
            const roleStatus = setup.discord.roles?.[role];
            const configured = Boolean(roleStatus?.configured);
            const preparationKey = `${stepProvider}:${role}`;
            const prepared =
                setupWizardState.discordPreparationKey === preparationKey
                    ? setupWizardState.discordPreparation
                    : undefined;
            const canInstallDiscord =
                prepared &&
                (prepared.redirectUriRegistered === true ||
                    (prepared.redirectUriRegistered === undefined &&
                        setupWizardState.discordRedirectConfirmed));
            const canRecheckDiscord =
                prepared?.redirectUriRegistered === false &&
                setupWizardState.discordRedirectConfirmed;
            const discordInstalled = Boolean(roleStatus?.installed);
            const discordOwnerMissing =
                discordInstalled &&
                !setupProviderOwnerConfigured(setup, 'discord', role);
            const providerOnlyReconnect =
                setupWizardState.providerOnly?.provider === stepProvider &&
                setupWizardState.providerOnly.role === role &&
                discordInstalled;
            stepContent = `
      <div class="wizard-step">
        <h1>Set up Discord ${escapeHtml(roleLabel(role).toLowerCase())}</h1>
        <p>${
            role === 'personal'
                ? 'This app identifies the represented owner for personal DM handling.'
                : 'This app watches selected Discord channels during active sessions.'
        }</p>
        ${discordConnectGuide({ role, roleStatus, prepared, ownerMissing: discordOwnerMissing, interactionsUrl: setup.discord.interactionsUrl })}
        ${
            discordInstalled
                ? `<div class="setup-success">Discord ${role} bot connected</div>`
                : prepared
                  ? discordPreparationDetails(prepared)
                  : configured
                    ? `<div class="setup-success">Discord app values are saved</div>
                       <p>Check the Discord application before opening authorization.</p>`
                    : `<form class="form" id="discord-config-form">
               <label>
                 <span>${rolePrefix}_BOT_TOKEN</span>
                 <input type="password" name="botToken" autocomplete="off" ${roleStatus?.configured ? '' : 'required'} />
               </label>
               <label>
                 <span>${rolePrefix}_CLIENT_SECRET</span>
                 <input type="password" name="clientSecret" autocomplete="off" ${roleStatus?.configured ? '' : 'required'} />
               </label>
             </form>`
        }
        ${
            discordOwnerMissing
                ? '<div class="notice danger">Discord is connected, but Murph does not know the OAuth owner for this role yet. Reconnect Discord from this setup flow.</div>'
                : ''
        }
        <div class="wizard-actions">
               <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
               ${
                   discordOwnerMissing
                       ? `<a class="button" href="/api/discord/${role}/install?source=setup">Reconnect Discord ${role} bot</a>`
                       : providerOnlyReconnect
                         ? `<a class="button" href="/api/discord/${role}/install?source=setup">Reconnect Discord ${role} bot</a>`
                       : discordInstalled
                         ? '<button type="button" id="wizard-next">Continue</button>'
                         : prepared
                           ? canInstallDiscord
                               ? `<a class="button" href="${escapeHtml(prepared.installUrl)}">${role === 'personal' ? 'Connect Discord DM bot' : 'Connect Discord server'}</a>`
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
        const ownerConfigured = setupProviderOwnerConfigured(
            setup,
            stepProvider,
            'channel',
        );
        const channelWorkspace = setupProviderWorkspace(
            setup,
            stepProvider,
            'channel',
        );
        stepContent = `
      <div class="wizard-step">
        <h1>Choose ${providerLabel(stepProvider)} channels</h1>
        <p>Pick the ${escapeHtml(providerLabel(stepProvider))} channels Murph should watch by default.</p>
        ${setupGuide({
            nextAction: ownerConfigured
                ? 'Choose the default channels for this channel bot, or use all accessible channels if this runtime owns the full workspace scope.'
                : `Reconnect ${providerLabel(stepProvider)} so Murph can identify the OAuth owner before saving channel defaults.`,
            stateRows: [
                {
                    label: 'Workspace',
                    value: channelWorkspace?.name ?? 'Not connected',
                    status: channelWorkspace ? 'ok' : 'action',
                },
                {
                    label: 'Owner identity',
                    value: ownerConfigured ? 'Known' : 'Needs OAuth',
                    status: ownerConfigured ? 'ok' : 'action',
                },
            ],
        })}
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
        <h1>Configure schedule</h1>
        <p>Set the default workday Murph uses for reminders, availability, and time-aware context.</p>
        <form class="form" id="schedule-config-form">
          <label>
            <span>Timezone</span>
            <select name="timezone">
              ${scheduleTimezoneOptions(setupWizardState.timezone)}
            </select>
          </label>
          <label>
            <span>Workday start hour</span>
            <input type="number" name="workdayStartHour" min="0" max="23" value="${escapeHtml(String(setupWizardState.workdayStartHour))}" required />
          </label>
          <label>
            <span>Workday end hour</span>
            <input type="number" name="workdayEndHour" min="1" max="24" value="${escapeHtml(String(setupWizardState.workdayEndHour))}" required />
          </label>
        </form>
        <div class="wizard-actions">
          <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
          <button type="button" id="wizard-next">Save and continue</button>
        </div>
      </div>
    `;
    } else if (stepKey === 'policy') {
        stepContent = `
      <div class="wizard-step">
        <h1>Configure policy</h1>
        <p>Choose the policy profile Murph uses by default.</p>
        <form class="form" id="policy-config-form">
          <label>
            <span>Policy profile</span>
            <select name="profileName">
              ${policyProfileOptions(policyConfig.profiles, policyConfig.selectedProfileName)}
            </select>
          </label>
          <dl class="details compact-details">
            <div><dt>Execution mode</dt><dd>${escapeHtml(policyExecutionModeLabel(policyConfig.mode))}</dd></div>
          </dl>
        </form>
        <div class="wizard-actions">
          <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
          <button type="button" id="wizard-next">Save and continue</button>
        </div>
      </div>
    `;
    } else if (stepKey === 'finish') {
        stepContent = `
      <div class="wizard-step">
        <h1>Finish setup</h1>
        <p>Murph has the selected channel and mode configuration. Finish setup to save these defaults and open the dashboard.</p>
        <div class="setup-summary-list">
          <div class="setup-summary-row ok">
            <span>AI model</span>
            <strong>${setup.provider.configured ? escapeHtml(setup.provider.defaultProvider) : 'Needs API key'}</strong>
          </div>
          <div class="setup-summary-row ${setup.murphConfig?.scheduleConfigured ? 'ok' : 'warning'}">
            <span>Schedule</span>
            <strong>${setup.murphConfig?.scheduleConfigured ? escapeHtml(`${setup.murphConfig.workdayStartHour}:00-${setup.murphConfig.workdayEndHour}:00 ${setup.murphConfig.timezone}`) : 'Needs configuration'}</strong>
          </div>
          <div class="setup-summary-row ${setup.murphConfig?.policyConfigured ? 'ok' : 'warning'}">
            <span>Policy</span>
            <strong>${setup.murphConfig?.policyConfigured ? escapeHtml(`${setup.murphConfig.policyProfileName} · ${policyExecutionModeLabel(policyConfig.mode)}`) : 'Needs configuration'}</strong>
          </div>
          ${setupWizardState.selectedCoverage
              .map((key) => {
                  const [provider, role] = key.split(':') as [
                      SetupChannelProvider,
                      BotRole,
                  ];
                  return `
                    <div class="setup-summary-row ok">
                      <span>${escapeHtml(providerLabel(provider))}</span>
                      <strong>${escapeHtml(roleLabel(role))}</strong>
                    </div>
                  `;
              })
              .join('')}
          ${setupWizardState.selectedProviders
              .filter((provider) => coverageSelected(provider, 'channel'))
              .map((provider) => {
                  const selection = setupWizardState.providerSelections[provider];
                  const channelLabel =
                      selection.channelScopeMode === 'all_accessible'
                          ? 'All accessible channels'
                          : `${selection.selectedChannels.length} selected`;
                  return `
                    <div class="setup-summary-row ok">
                      <span>${escapeHtml(providerLabel(provider))} channels</span>
                      <strong>${escapeHtml(channelLabel)}</strong>
                    </div>
                  `;
              })
              .join('')}
        </div>
        <div class="wizard-actions">
          <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
          <button type="button" id="wizard-next">Finish setup</button>
        </div>
      </div>
    `;
    }

    app.innerHTML = `
    <div class="wizard-container">
      <header class="setup-topbar">
        <a class="wizard-brand" href="/" aria-label="Murph home"><img src="/img/murph-logo.svg" alt="" aria-hidden="true" />Murph</a>
        <div class="setup-topbar-step">
          <span>Step ${visibleStep} of ${totalSteps}</span>
          <strong>${escapeHtml(currentStepLabel)}</strong>
        </div>
        <a class="button secondary" href="${topbarHref}">${topbarLabel}</a>
      </header>
      <main class="setup-frame">
        <section class="wizard-panel">
          <div class="wizard-header">
            <div>
              <span class="setup-step-kicker">${escapeHtml(currentStepLabel)}</span>
              <div class="wizard-progress-segments">${progressSegments}</div>
            </div>
            <span class="setup-step-count">${String(visibleStep).padStart(2, '0')} / ${String(totalSteps).padStart(2, '0')}</span>
          </div>
          ${setupNotice}
          ${setupWizardState.errorMessage ? `<div class="notice danger">${escapeHtml(setupWizardState.errorMessage)}</div>` : ''}
          ${stepContent}
        </section>
      </main>
      <footer class="setup-footer">Local setup runs on this machine. Tokens are used only to configure your selected providers.</footer>
    </div>
  `;

    app.querySelector<HTMLInputElement>(
        '#discord-redirect-confirmed',
    )?.addEventListener('change', (event) => {
        setupWizardState.discordRedirectConfirmed = (
            event.currentTarget as HTMLInputElement
        ).checked;
        void renderSetup(onComplete);
    });

    if (stepKey === 'coverage') {
        const syncCoverageSelection = () => {
            const selectedRoles = Array.from(
                app.querySelectorAll<HTMLInputElement>(
                    'input[name="setupRole"]:checked',
                ),
            )
                .map((input) => input.value)
                .filter((value): value is BotRole =>
                    setupDistributionRoles(setup).includes(value as BotRole),
                );
            const selectedProviders = Array.from(
                app.querySelectorAll<HTMLInputElement>(
                    'input[name="setupProvider"]:checked',
                ),
            )
                .map((input) => input.value)
                .filter((value): value is SetupChannelProvider =>
                    SETUP_CHANNEL_PROVIDERS.includes(
                        value as SetupChannelProvider,
                    ),
                );
            setupWizardState.selectedCoverage = selectedProviders.flatMap(
                (provider) =>
                    selectedRoles.map(
                        (role) => `${provider}:${role}` as CoverageKey,
                    ),
            );
            syncCoverageStateFromKeys();
            saveSetupQueue();
            const nextBtn =
                app.querySelector<HTMLButtonElement>('#wizard-next');
            if (nextBtn)
                nextBtn.disabled =
                    selectedRoles.length === 0 ||
                    selectedProviders.length === 0;
            app.querySelectorAll<HTMLLabelElement>('.member-item').forEach(
                (item) => {
                    const input =
                        item.querySelector<HTMLInputElement>('input');
                    item.classList.toggle('selected', Boolean(input?.checked));
                },
            );
        };
        app.querySelectorAll<HTMLInputElement>(
            'input[name="setupRole"], input[name="setupProvider"]',
        ).forEach((input) => {
            input.addEventListener('change', syncCoverageSelection);
        });
    }

    if (stepProvider && stepKey.startsWith('channels:')) {
        const container = app.querySelector<HTMLDivElement>(
            '#channel-list-container',
        );
        const nextBtn = app.querySelector<HTMLButtonElement>('#wizard-next');
        const selection = setupWizardState.providerSelections[stepProvider];
        const workspace = setupProviderWorkspace(
            setup,
            stepProvider,
            'channel',
        );
        const ownerConfigured = setupProviderOwnerConfigured(
            setup,
            stepProvider,
            'channel',
        );
        try {
            if (!workspace) {
                throw new Error(
                    `${providerLabel(stepProvider)} is not connected yet.`,
                );
            }
            const channelsPayload = await getJson<SetupChannelsPayload>(
                `/api/setup/channels?provider=${encodeURIComponent(stepProvider)}&workspaceId=${encodeURIComponent(workspace.id)}`,
            );
            if (channelsPayload.channels.length > 0) {
                container!.innerHTML = `
          <label class="member-item channel-item ${selection.channelScopeMode === 'selected' ? 'selected' : ''}">
            <input type="radio" name="setupChannelMode" value="selected" ${selection.channelScopeMode !== 'all_accessible' ? 'checked' : ''} />
            <span class="member-avatar-placeholder">#</span>
            <span class="channel-copy">
              <strong>Selected channels</strong>
              <small>Recommended for focused async-work coverage</small>
            </span>
          </label>
          <label class="member-item channel-item ${selection.channelScopeMode === 'all_accessible' ? 'selected' : ''}">
            <input type="radio" name="setupChannelMode" value="all_accessible" ${selection.channelScopeMode === 'all_accessible' ? 'checked' : ''} />
            <span class="member-avatar-placeholder">*</span>
            <span class="channel-copy">
              <strong>All accessible channels</strong>
              <small>Use every ${escapeHtml(providerLabel(stepProvider))} channel this bot can read</small>
            </span>
          </label>
          <div class="member-list">
            ${channelsPayload.channels
                .map((channel) => {
                    const selected = selection.selectedChannelIds.includes(
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
                throw new Error(
                    `No ${providerLabel(stepProvider)} channels were available.`,
                );
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

    app.querySelector<HTMLButtonElement>('#slack-manual-save')?.addEventListener(
        'click',
        async () => {
            if (stepProvider !== 'slack' || !stepKey.startsWith('connect:')) {
                return;
            }
            setupWizardState.errorMessage = '';
            try {
                const role = stepRole ?? 'channel';
                const payload = slackManualConfigPayload(
                    app.querySelector<HTMLFormElement>('#slack-config-form'),
                    role,
                );
                if (!payload) return;
                await postJson('/api/setup/config', payload);
                setupWizardState.slackPreparation = undefined;
                setupWizardState.slackPreparationKey = undefined;
                await renderSetup(onComplete);
            } catch (error) {
                setupWizardState.errorMessage = setupErrorMessage(
                    error,
                    'Slack app values could not be saved.',
                );
                await renderSetup(onComplete);
            }
        },
    );

    app.querySelector<HTMLButtonElement>('#wizard-next')?.addEventListener(
        'click',
        async () => {
            setupWizardState.errorMessage = '';
            try {
                if (stepKey === 'ai') {
                    const form =
                        app.querySelector<HTMLFormElement>('#ai-provider-form');
                    const formData = form ? new FormData(form) : new FormData();
                    const provider = String(
                        formData.get('provider') ?? 'openai',
                    );
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
                    if (agentModelMode === 'custom' && !selectedAgentModel)
                        return;
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

                if (stepKey === 'coverage') {
                    if (setupWizardState.selectedCoverage.length === 0) return;
                    syncCoverageStateFromKeys();
                    saveSetupQueue();
                    await postJson('/api/setup/config', {
                        MURPH_BOT_ROLES: setupWizardState.botRoles.join(','),
                    });
                }

                if (
                    stepProvider === 'slack' &&
                    stepKey.startsWith('connect:') &&
                    !setup.slack.roles?.[stepRole ?? 'channel']?.configured
                ) {
                    const role = stepRole ?? 'channel';
                    const roleStatus = setup.slack.roles?.[role];
                    const preparationKey = `${stepProvider}:${role}`;
                    const prepared =
                        setupWizardState.slackPreparationKey === preparationKey
                            ? setupWizardState.slackPreparation
                            : undefined;
                    const remainingUnpreparedSlackRoles = () =>
                        selectedSlackRoles().filter(
                            (selectedRole) =>
                                selectedRole !== role &&
                                !setup.slack.roles?.[selectedRole]
                                    ?.oauthConfigured,
                        );

                    if (roleStatus?.oauthConfigured || prepared) {
                        const form =
                            app.querySelector<HTMLFormElement>(
                                '#slack-app-token-form',
                            );
                        const formData = form
                            ? new FormData(form)
                            : new FormData();
                        const appToken = String(
                            formData.get('appToken') ?? '',
                        ).trim();
                        if (!appToken) return;
                        requireSlackAppLevelToken(
                            appToken,
                            role === 'personal'
                                ? 'SLACK_PERSONAL_APP_TOKEN'
                                : 'SLACK_CHANNEL_APP_TOKEN',
                        );
                        await postJson('/api/setup/config', {
                            ...(role === 'personal'
                                ? { SLACK_PERSONAL_APP_TOKEN: appToken }
                                : {
                                      SLACK_CHANNEL_APP_TOKEN: appToken,
                                      SLACK_APP_TOKEN: appToken,
                                  }),
                        });
                        setupWizardState.slackPreparation = undefined;
                        setupWizardState.slackPreparationKey = undefined;
                        if (remainingUnpreparedSlackRoles().length === 0) {
                            setupWizardState.slackConfigurationToken =
                                undefined;
                        }
                        await renderSetup(onComplete);
                        return;
                    }

                    const form =
                        app.querySelector<HTMLFormElement>(
                            '#slack-manifest-form',
                        );
                    const formData = form ? new FormData(form) : new FormData();
                    const configurationToken = String(
                        formData.get('configurationToken') ??
                            setupWizardState.slackConfigurationToken ??
                            '',
                    ).trim();
                    if (!configurationToken) return;
                    const configurationTokenError =
                        slackConfigurationTokenValidationMessage(
                            configurationToken,
                        );
                    if (configurationTokenError) {
                        setupWizardState.errorMessage =
                            configurationTokenError;
                        await renderSetup(onComplete);
                        return;
                    }
                    setupWizardState.slackConfigurationToken =
                        configurationToken;
                    setupWizardState.slackPreparation =
                        await postJson<SlackSetupPreparePayload>(
                            '/api/setup/slack/prepare',
                            {
                                role,
                                configurationToken,
                            },
                        );
                    setupWizardState.slackPreparationKey = preparationKey;
                    if (remainingUnpreparedSlackRoles().length === 0) {
                        setupWizardState.slackConfigurationToken = undefined;
                    }
                    await renderSetup(onComplete);
                    return;
                }

                if (
                    stepProvider === 'discord' &&
                    stepKey.startsWith('connect:') &&
                    !setup.discord.roles?.[stepRole ?? 'channel']?.installed
                ) {
                    const role = stepRole ?? 'channel';
                    const preparationKey = `${stepProvider}:${role}`;
                    const prepared =
                        setupWizardState.discordPreparationKey ===
                        preparationKey
                            ? setupWizardState.discordPreparation
                            : undefined;
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
                            setupWizardState.discordPreparation =
                                await postJson<DiscordSetupPreparePayload>(
                                    '/api/setup/discord/prepare',
                                    { role },
                                );
                            setupWizardState.discordPreparationKey =
                                preparationKey;
                            setupWizardState.discordRedirectConfirmed =
                                setupWizardState.discordPreparation
                                    .redirectUriRegistered === true;
                            await renderSetup(onComplete);
                        }
                        return;
                    }
                    const form = app.querySelector<HTMLFormElement>(
                        '#discord-config-form',
                    );
                    const formData = form ? new FormData(form) : new FormData();
                    const botToken = String(
                        formData.get('botToken') ?? '',
                    ).trim();
                    const clientSecret = String(
                        formData.get('clientSecret') ?? '',
                    ).trim();
                    if (
                        !setup.discord.roles?.[role]?.configured &&
                        (!botToken || !clientSecret)
                    )
                        return;
                    const payload: {
                        botToken?: string;
                        clientSecret?: string;
                        role: BotRole;
                    } = { role };
                    if (botToken) payload.botToken = botToken;
                    if (clientSecret) payload.clientSecret = clientSecret;
                    setupWizardState.discordPreparation =
                        await postJson<DiscordSetupPreparePayload>(
                            '/api/setup/discord/prepare',
                            payload,
                        );
                    setupWizardState.discordPreparationKey = preparationKey;
                    setupWizardState.discordRedirectConfirmed =
                        setupWizardState.discordPreparation
                            .redirectUriRegistered === true;
                    await renderSetup(onComplete);
                    return;
                }

                if (stepKey === 'schedule') {
                    const form =
                        app.querySelector<HTMLFormElement>(
                            '#schedule-config-form',
                        );
                    const formData = form ? new FormData(form) : new FormData();
                    const timezone = String(
                        formData.get('timezone') ?? setupWizardState.timezone,
                    ).trim();
                    const workdayStartHour = Number(
                        formData.get('workdayStartHour'),
                    );
                    const workdayEndHour = Number(
                        formData.get('workdayEndHour'),
                    );
                    if (
                        !timezone ||
                        !Number.isFinite(workdayStartHour) ||
                        !Number.isFinite(workdayEndHour) ||
                        workdayStartHour < 0 ||
                        workdayStartHour > 23 ||
                        workdayEndHour < 1 ||
                        workdayEndHour > 24 ||
                        workdayEndHour <= workdayStartHour
                    ) {
                        setupWizardState.errorMessage =
                            'Schedule must include a timezone and a valid workday range.';
                        await renderSetup(onComplete);
                        return;
                    }
                    setupWizardState.timezone = timezone;
                    setupWizardState.workdayStartHour = workdayStartHour;
                    setupWizardState.workdayEndHour = workdayEndHour;
                    await postJson('/api/setup/config', {
                        MURPH_TIMEZONE: timezone,
                        MURPH_WORKDAY_START_HOUR: String(workdayStartHour),
                        MURPH_WORKDAY_END_HOUR: String(workdayEndHour),
                    });
                    const updatedSetup =
                        await getJson<SetupStatusPayload>('/api/setup/status');
                    const updatedStepKeys = setupStepKeys(updatedSetup);
                    const policyIndex = updatedStepKeys.indexOf('policy');
                    setupWizardState.currentStep =
                        policyIndex >= 0
                            ? policyIndex
                            : Math.max(0, updatedStepKeys.indexOf('finish'));
                    await renderSetup(onComplete);
                    return;
                }

                if (stepKey === 'policy') {
                    const form =
                        app.querySelector<HTMLFormElement>(
                            '#policy-config-form',
                        );
                    const formData = form ? new FormData(form) : new FormData();
                    await putJson('/api/gateway/policy/config', {
                        profileName: String(formData.get('profileName') ?? ''),
                    });
                    const updatedSetup =
                        await getJson<SetupStatusPayload>('/api/setup/status');
                    const updatedStepKeys = setupStepKeys(updatedSetup);
                    setupWizardState.currentStep = Math.max(
                        0,
                        updatedStepKeys.indexOf('finish'),
                    );
                    await renderSetup(onComplete);
                    return;
                }

                if (
                    stepProvider &&
                    stepKey.startsWith('channels:') &&
                    setupWizardState.providerSelections[stepProvider]
                        .channelScopeMode === 'selected' &&
                    setupWizardState.providerSelections[stepProvider]
                        .selectedChannelIds.length === 0
                ) {
                    return;
                }
                if (stepProvider && stepKey.startsWith('channels:')) {
                    const selection =
                        setupWizardState.providerSelections[stepProvider];
                    const primary =
                        setupWizardState.providerSelections[
                            setupPrimaryProvider()
                        ];
                    await putJson('/api/setup/defaults', {
                        botRoles: setupWizardState.botRoles,
                        channelProvider: setupPrimaryProvider(),
                        workspaceId: primary.workspaceId,
                        ownerUserId: primary.ownerUserId,
                        ownerDisplayName: primary.ownerDisplayName,
                        workspaceOwners: selectedWorkspaceOwnersPayload(
                            defaults.defaults,
                        ),
                        workspaceChannels: selectedWorkspaceChannelsPayload(),
                        channelScopeMode: selection.channelScopeMode,
                        selectedChannels:
                            selection.channelScopeMode === 'selected'
                                ? selection.selectedChannels
                                : [],
                    });
                }

                if (stepKey === 'finish') {
                    const primaryProvider = setupPrimaryProvider();
                    const primary =
                        setupWizardState.providerSelections[primaryProvider];
                    await putJson('/api/setup/defaults', {
                        botRoles: setupWizardState.botRoles,
                        channelProvider: primaryProvider,
                        workspaceId: primary.workspaceId,
                        ownerUserId: primary.ownerUserId,
                        ownerDisplayName: primary.ownerDisplayName,
                        workspaceOwners: selectedWorkspaceOwnersPayload(
                            defaults.defaults,
                        ),
                        workspaceChannels: selectedWorkspaceChannelsPayload(),
                        channelScopeMode: primary.channelScopeMode,
                        selectedChannels:
                            primary.channelScopeMode === 'selected'
                                ? primary.selectedChannels
                                : [],
                    });
                    const setupStatus =
                        await getJson<SetupStatusPayload>('/api/setup/status');
                    const missing = [
                        ...(adminChannelWorkspaces(setupStatus).length === 0
                            ? ['workspace connection']
                            : []),
                        ...(!setupStatus.userConfigured
                            ? ['owner identity']
                            : []),
                        ...(!setupStatus.rolesReady
                            ? ['selected bot roles']
                            : []),
                    ];
                    if (missing.length > 0) {
                        setupWizardState.errorMessage = `Setup is still incomplete: ${missing.join(', ')}.`;
                        await renderSetup(onComplete);
                        return;
                    }

                    sessionStorage.removeItem(SETUP_QUEUE_STORAGE_KEY);
                    clearProviderOnlySetup();
                    setCurrentUser(
                        primary.ownerUserId,
                        primary.ownerDisplayName,
                    );
                    setSelectedChannels(primary.selectedChannels);
                    for (const provider of setupWizardState.selectedProviders) {
                        const selection =
                            setupWizardState.providerSelections[provider];
                        if (selection.workspaceId) {
                            setHomeWorkspaceEnabled(
                                selection.workspaceId,
                                true,
                            );
                            setHomeChannelSelection(
                                selection.workspaceId,
                                selection.channelScopeMode,
                                selection.selectedChannels,
                            );
                        }
                    }
                    history.replaceState(null, '', '/');
                    await onComplete();
                    return;
                }

                advanceSetupStep(stepKeys, step, stepKey, setup);
                await renderSetup(onComplete);
            } catch (error) {
                setupWizardState.errorMessage = setupErrorMessage(
                    error,
                    'Setup could not save that step.',
                );
                await renderSetup(onComplete);
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
            await renderSetup(onComplete);
        },
    );
}
