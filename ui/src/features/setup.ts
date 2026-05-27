import { ApiError, getJson, postJson, putJson } from '../shared/api';
import { agentModel, agentModelFields, agentProvider } from '../shared/agent';
import { escapeHtml, setTitle } from '../shared/format';
import { providerLabel, roleDescription, roleLabel } from '../shared/labels';
import { app } from '../shared/shell';
import {
    setCurrentUser,
    setHomeChannelSelection,
    setHomeWorkspaceEnabled,
    setSelectedChannels,
} from '../shared/storage';
import {
    adminChannelWorkspaces,
    channelBadge,
    defaultOwnerForWorkspace,
} from '../shared/workspaces';
import type {
    BotRole,
    ChannelWorkspace,
    DiscordSetupPreparePayload,
    ProviderRoleSetupStatus,
    SetupChannelsPayload,
    SetupDefaultsPayload,
    SetupDoctorPayload,
    SetupStatusPayload,
    SlackSetupPreparePayload,
} from '../shared/types';

type SetupWizardState = {
    currentStep: number;
    botRoles: BotRole[];
    selectedProviders: Array<'slack' | 'discord'>;
    selectedCoverage: CoverageKey[];
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
};

type SetupChannelProvider = 'slack' | 'discord';
type CoverageKey = `${SetupChannelProvider}:${BotRole}`;
type SetupStepKey =
    | 'ai'
    | 'coverage'
    | 'finish'
    | `connect:${SetupChannelProvider}:${BotRole}`
    | `channels:${SetupChannelProvider}`;

const SETUP_CHANNEL_PROVIDERS: SetupChannelProvider[] = ['slack', 'discord'];
const SETUP_BOT_ROLES: BotRole[] = ['channel', 'personal'];
const SETUP_QUEUE_STORAGE_KEY = 'murph_setup_queue';

let setupWizardState: SetupWizardState = {
    currentStep: 0,
    botRoles: ['channel'],
    selectedProviders: [],
    selectedCoverage: [],
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
    setupWizardState.selectedCoverage = roles.map(
        (role) => `${provider}:${role}` as CoverageKey,
    );
    setupWizardState.currentStep = 0;
    syncCoverageStateFromKeys();
    saveSetupQueue();
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

function setupCoverageRows(): Array<{
    provider: SetupChannelProvider;
    role: BotRole;
}> {
    return SETUP_CHANNEL_PROVIDERS.flatMap((provider) =>
        SETUP_BOT_ROLES.map((role) => ({ provider, role })),
    );
}

function orderedSetupCoverageRows(): Array<{
    provider: SetupChannelProvider;
    role: BotRole;
}> {
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
        SETUP_BOT_ROLES.map((role) => ({ provider, role })),
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
    setupWizardState.botRoles = setup.botRoles?.length
        ? setup.botRoles
        : setupWizardState.botRoles;
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
        syncCoverageStateFromKeys();
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
        'finish',
    ];
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

    return Math.max(0, stepKeys.indexOf('finish'));
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
            : 'Provide a Slack app configuration token so Murph can create or update the app from the manifest.'
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

function discordConnectGuide(input: {
    role: BotRole;
    roleStatus?: ProviderRoleSetupStatus;
    prepared?: DiscordSetupPreparePayload;
    ownerMissing: boolean;
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
            ...(redirectUri
                ? [{ label: 'OAuth redirect URI', value: redirectUri }]
                : []),
            {
                label: 'Config fields',
                value: discordRoleConfigKeys(input.role),
            },
        ],
    });
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
        <label>
          <span>Existing Slack app ID, optional</span>
          <input name="existingAppId" placeholder="A0123456789" autocomplete="off" />
        </label>
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

function slackManualConfigForm(role: BotRole): string {
    const prefix = role === 'personal' ? 'SLACK_PERSONAL' : 'SLACK_CHANNEL';
    return `
      <details class="setup-advanced setup-manual-config">
        <summary>Enter Slack app values manually</summary>
        <form class="form" id="slack-config-form">
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
          <button type="button" class="secondary" id="slack-manual-save">Save manual values</button>
        </form>
      </details>
    `;
}

function slackManualConfigPayload(
    form: HTMLFormElement | null,
    role: BotRole,
): Record<string, string> | undefined {
    const formData = form ? new FormData(form) : new FormData();
    const appToken = String(formData.get('appToken') ?? '').trim();
    const clientId = String(formData.get('clientId') ?? '').trim();
    const clientSecret = String(formData.get('clientSecret') ?? '').trim();
    const signingSecret = String(formData.get('signingSecret') ?? '').trim();
    if (!appToken || !clientId || !clientSecret) return undefined;

    return {
        SLACK_EVENTS_MODE: 'socket',
        ...(role === 'personal'
            ? {
                  SLACK_PERSONAL_APP_TOKEN: appToken,
                  SLACK_PERSONAL_CLIENT_ID: clientId,
                  SLACK_PERSONAL_CLIENT_SECRET: clientSecret,
                  ...(signingSecret
                      ? { SLACK_PERSONAL_SIGNING_SECRET: signingSecret }
                      : {}),
              }
            : {
                  SLACK_CHANNEL_APP_TOKEN: appToken,
                  SLACK_CHANNEL_CLIENT_ID: clientId,
                  SLACK_CHANNEL_CLIENT_SECRET: clientSecret,
                  ...(signingSecret
                      ? { SLACK_CHANNEL_SIGNING_SECRET: signingSecret }
                      : {}),
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
      ${configurationNotice}
      ${intentNotice}
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
        restoreSetupQueue();
    }
    const slackCliReturn =
        returnedStep === 'slack' && params.get('source') === 'cli';
    if (
        returnedStep === 'slack' &&
        params.get('success') === '1' &&
        !slackCliReturn
    ) {
        setupNotice = `<div class="setup-success">Slack ${escapeHtml(returnedRole)} bot connected</div>`;
        if (!coverageSelected('slack', returnedRole)) {
            setupWizardState.selectedCoverage = [
                ...setupWizardState.selectedCoverage,
                `slack:${returnedRole}` as CoverageKey,
            ];
            syncCoverageStateFromKeys();
        }
        saveSetupQueue();
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
        }
        history.replaceState(null, '', '/setup');
    } else if (launchedFromAdmin) {
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
        app.querySelector<HTMLButtonElement>('#setup-retry')?.addEventListener(
            'click',
            () => {
                void renderSetup(onComplete);
            },
        );
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

    const dots = `
    ${Array.from({ length: totalSteps }, (_, i) => {
        const current = step;
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

    if (stepKey === 'ai') {
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
    } else if (stepKey === 'coverage') {
        const selectedRoles = new Set(
            SETUP_BOT_ROLES.filter((role) =>
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
        const roleCards = SETUP_BOT_ROLES.map((role) => {
            const checked = selectedRoles.has(role);
            return `
          <label class="member-item channel-item ${checked ? 'selected' : ''}">
            <input type="checkbox" name="setupRole" value="${role}" ${checked ? 'checked' : ''} />
            <span class="member-avatar-placeholder">${role === 'channel' ? '#' : '@'}</span>
            <span class="channel-copy">
              <strong>${escapeHtml(roleLabel(role))}${role === 'channel' ? ' (recommended)' : ''}</strong>
              <small>${escapeHtml(roleDescription(role))}</small>
            </span>
          </label>
        `;
        }).join('');
        const providerOptions = SETUP_CHANNEL_PROVIDERS.map((provider) => {
            const checked = selectedProviders.has(provider);
            const providerRows = SETUP_BOT_ROLES.filter((role) =>
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
        <h1>Choose channel and mode</h1>
        <p>Select where Murph should connect, then choose whether it should run channel coverage, personal coverage, or both.</p>
        <div class="member-list provider-list">${providerOptions}</div>
        <h2 class="setup-subhead">Mode</h2>
        <div class="member-list setup-role-list">${roleCards}</div>
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
            stepContent = `
      <div class="wizard-step">
        <h1>${slackConfigured ? 'Connect Slack workspace' : 'Create Slack app'}</h1>
        <p>${
            role === 'personal'
                ? 'This app handles direct messages for the represented owner.'
                : 'This app watches the channels you choose during handoff sessions.'
        }</p>
        ${slackConnectGuide({ role, roleStatus, connected: slackConnected, ownerMissing: slackOwnerMissing })}
        ${
            slackConfigured
                ? `<div class="setup-success">Slack ${role} app config is ready</div>`
                : needsAppToken || prepared
                  ? `${prepared ? slackPreparationDetails(prepared) : ''}
                     ${slackAppTokenForm(role)}`
                  : `${slackManifestForm(canReuseConfigurationToken)}
                     ${slackManualConfigForm(role)}`
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
            stepContent = `
      <div class="wizard-step">
        <h1>Connect Discord bot</h1>
        <p>${
            role === 'personal'
                ? 'This app identifies the represented owner for personal DM handling.'
                : 'This app watches selected Discord channels during handoff sessions.'
        }</p>
        ${discordConnectGuide({ role, roleStatus, prepared, ownerMissing: discordOwnerMissing })}
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
                       : discordInstalled
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
        <h1>Choose channels</h1>
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
    } else if (stepKey === 'finish') {
        stepContent = `
      <div class="wizard-step">
        <h1>Finish setup</h1>
        <p>Murph has the selected channel and mode configuration. Finish setup to save these defaults and open the dashboard.</p>
        <div class="setup-task">
          <p>Selected modes</p>
          <div class="setup-status-line">
            ${setupWizardState.selectedCoverage
                .map((key) => {
                    const [provider, role] = key.split(':') as [
                        SetupChannelProvider,
                        BotRole,
                    ];
                    return `<span class="setup-status-item ok"><span>${escapeHtml(providerLabel(provider))}</span><strong>${escapeHtml(roleLabel(role))}</strong></span>`;
                })
                .join('')}
          </div>
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
                    SETUP_BOT_ROLES.includes(value as BotRole),
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
              <small>Recommended for a focused handoff</small>
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
                    const existingAppId = String(
                        formData.get('existingAppId') ?? '',
                    ).trim();
                    if (!configurationToken) return;
                    setupWizardState.slackConfigurationToken =
                        configurationToken;
                    setupWizardState.slackPreparation =
                        await postJson<SlackSetupPreparePayload>(
                            '/api/setup/slack/prepare',
                            {
                                role,
                                configurationToken,
                                ...(existingAppId ? { existingAppId } : {}),
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
