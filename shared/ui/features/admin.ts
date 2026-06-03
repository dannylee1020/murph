import {
    adminChannelWorkspaces,
    workspaceOptionLabel,
    channelBadge,
    defaultOwnerForWorkspace
} from '../shared/workspaces';
import {
    app,
    setSidebarWatchingCount,
    themeControlHtml,
    activeNavHref,
    routeSlug,
    consoleStateHtml,
    sidebarWatchingStatusHtml,
    shell,
    loading,
    errorView
} from '../shared/shell';
import {
    providerLabel,
    roleLabel,
    roleDescription
} from '../shared/labels';
import {
    agentProvider,
    agentModel,
    runtimeModel,
    agentModelFields
} from '../shared/agent';
import {
    getCurrentUserId,
    getCurrentUserName,
    setCurrentUser,
    getSelectedChannels,
    setSelectedChannels,
    storageKey,
    getHomeWorkspaceEnabled,
    setHomeWorkspaceEnabled,
    getHomeChannelMode,
    getHomeSelectedChannels,
    setHomeChannelSelection
} from '../shared/storage';
import {
    escapeHtml,
    setTitle,
    formatToday,
    formatSessionStatus,
    formatRelative,
    formatDateTime,
    formatExactIso
} from '../shared/format';
import { ApiError, deleteJson, getJson, postJson, putJson } from '../shared/api';
import type {
    CompiledPolicyPayload,
    SummaryPayload,
    RuntimePayload,
    SetupCheckStatus,
    SetupDoctorPayload,
    SetupStatusPayload,
    BotRole,
    SetupRoleLinks,
    ProviderRoleSetupStatus,
    ChannelWorkspace,
    SetupDefaultsPayload,
    DiscordSetupPreparePayload,
    SlackSetupPreparePayload,
    IntegrationStatusPayload,
    GitHubRepositoriesPayload,
    SetupChannelsPayload,
    ChannelChoice,
    MemberChoice,
    HomeWorkspaceChannelState,
    QueuePayload,
    TriagePayload,
    SessionsPayload,
    AuditPayload,
    TracesPayload,
    RunsPayload,
    RunEventsPayload,
    RecurringJobsPayload,
    ChannelActionItem,
    SessionCreateResponse,
    PolicyProfilesPayload,
    PolicyConfigPayload
} from '../shared/types';

import {
    ADMIN_WORKSPACE_STORAGE_KEY,
    HOME_WORKSPACE_STORAGE_KEY,
    DEFAULT_HOME_TIMEZONE,
    DEFAULT_HOME_WORKDAY_START_HOUR,
    activeSessionRows,
    calculateDurationHours,
    channelSummaryLabel,
    combinedChannelSummary,
    getTimezoneOptions,
    googleOAuthDialog,
    homeChannelGroups,
    integrationCard,
    integrationCredentialDialog,
    list,
    metric,
    missingOwnerNotice,
    ownerDisplayName,
    plainLanguageModeLabel,
    policyExecutionModeLabel,
    policyProfileDialog,
    policyProfileOptions,
    policySummary,
    resolveAdminWorkspaceId,
    renderToolCallsDisclosure,
    sessionCreateErrorHtml,
    sessionErrorHtml,
    sessionFeedbackHtml,
    sessionModeLabel,
    setDashboardError,
    clearDashboardError,
    setDashboardNotice,
    clearDashboardNotice,
    timezoneLabel,
    workspaceMetric,
} from './page-helpers';

const MANAGED_PROVIDERS = ['slack', 'discord'] as const;
type ManagedProvider = (typeof MANAGED_PROVIDERS)[number];
const PROVIDER_MODE_ROLES: BotRole[] = ['channel', 'personal'];

function distributionRoles(setup: SetupStatusPayload): BotRole[] {
    return setup.distribution === 'personal' ? ['personal'] : ['channel'];
}

function distributionName(setup: SetupStatusPayload): string {
    return setup.distribution === 'personal' ? 'Murph Personal' : 'Murph Team';
}

function isManagedProvider(value: string): value is ManagedProvider {
    return MANAGED_PROVIDERS.includes(value as ManagedProvider);
}

function providerModeRoles(
    setup: SetupStatusPayload,
    provider: ManagedProvider,
): BotRole[] {
    if (
        setup.providerBotRoles &&
        Object.prototype.hasOwnProperty.call(setup.providerBotRoles, provider)
    ) {
        const allowed = distributionRoles(setup);
        return (setup.providerBotRoles[provider] ?? []).filter((role) =>
            allowed.includes(role),
        );
    }
    const allowed = distributionRoles(setup);
    const configured = setup.botRoles?.length ? setup.botRoles : allowed;
    return configured.filter((role) => allowed.includes(role));
}

function providerModeSummary(
    setup: SetupStatusPayload,
    provider: ManagedProvider,
): string {
    const roles = providerModeRoles(setup, provider);
    if (roles.length === 0) return 'Off';
    return PROVIDER_MODE_ROLES.filter((role) => roles.includes(role))
        .map(roleLabel)
        .join(' + ');
}

function providerRoleStatus(
    setup: SetupStatusPayload,
    provider: ManagedProvider,
    role: BotRole,
): ProviderRoleSetupStatus | undefined {
    return setup[provider].roles?.[role];
}

function providerRoleInstalled(
    setup: SetupStatusPayload,
    provider: ManagedProvider,
    role: BotRole,
): boolean {
    const status = providerRoleStatus(setup, provider, role);
    if (status) return Boolean(status.installed);
    return Boolean(setup[provider].installed);
}

function providerRoleConfigured(
    setup: SetupStatusPayload,
    provider: ManagedProvider,
    role: BotRole,
): boolean {
    const status = providerRoleStatus(setup, provider, role);
    if (status) return Boolean(status.configured);
    return provider === 'slack'
        ? Boolean(setup.slack.oauthConfigured && setup.slack.socketConfigured)
        : Boolean(setup.discord.botTokenConfigured && setup.discord.clientIdConfigured);
}

function providerRoleOwnerNeedsReconnect(
    status: ProviderRoleSetupStatus | undefined,
    role: BotRole,
): boolean {
    return role === 'personal'
        ? status?.representedOwnerConfigured === false
        : status?.ownerConfigured === false;
}

function providerModeRows(
    setup: SetupStatusPayload,
    provider: ManagedProvider,
): string {
    const enabledRoles = new Set(providerModeRoles(setup, provider));
    return distributionRoles(setup).map((role) => {
        const status = providerRoleStatus(setup, provider, role);
        const setupUrl = `/setup?provider=${provider}&mode=${role}`;
        const installLabel = status?.installed ? 'Connected' : 'Not connected';
        const configLabel = status?.configured ? 'configured' : 'needs setup';
        return `
          <label class="toggle-row provider-mode-toggle">
            <input type="checkbox" name="role" value="${role}" ${enabledRoles.has(role) ? 'checked' : ''} />
            <span>
              <strong>${escapeHtml(roleLabel(role))}</strong>
              <small>${escapeHtml(roleDescription(role))}</small>
              <small>${escapeHtml(installLabel)} · ${escapeHtml(configLabel)} · <a href="${setupUrl}">${status?.installed ? 'Reconnect' : 'Set up'}</a></small>
            </span>
          </label>
        `;
    }).join('');
}

function providerModesDialog(): string {
    return `
      <dialog class="modal" id="provider-modes-dialog">
        <div class="modal-panel">
          <div class="modal-head">
            <div>
              <p class="eyebrow" id="provider-modes-eyebrow">Coverage</p>
              <h2 id="provider-modes-title">Manage coverage</h2>
            </div>
            <button type="button" class="icon-button close-provider-modes" aria-label="Close">×</button>
          </div>
          <p class="modal-intro">Turn off this provider's coverage for the current distribution. This does not uninstall the app or remove saved credentials.</p>
          <form class="form compact-form" id="provider-modes-form">
            <div class="provider-mode-list" id="provider-modes-list"></div>
            <p class="modal-error" id="provider-modes-error" hidden></p>
            <div class="actions">
              <button type="button" class="secondary close-provider-modes">Cancel</button>
              <button type="submit">Save coverage</button>
            </div>
          </form>
        </div>
      </dialog>
    `;
}

export async function renderSettings(): Promise<void> {
    loading('Settings');

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
    const isTeamDistribution = setup.distribution !== 'personal';
    setTitle(isTeamDistribution ? 'Murph Admin' : 'Murph Settings');
    const runtimeLabel = distributionName(setup);
    const settingsLabel = isTeamDistribution ? 'Admin' : 'Settings';
    const setupMode: BotRole = isTeamDistribution ? 'channel' : 'personal';
    const slackRoleStatus = providerRoleStatus(setup, 'slack', setupMode);
    const discordRoleStatus = providerRoleStatus(setup, 'discord', setupMode);
    const slackConnected = providerRoleInstalled(setup, 'slack', setupMode);
    const discordConnected = providerRoleInstalled(setup, 'discord', setupMode);
    const slackConfigured = providerRoleConfigured(setup, 'slack', setupMode);
    const discordConfigured = providerRoleConfigured(setup, 'discord', setupMode);
    const channelConnected = slackConnected || discordConnected || workspaces.length > 0;
    const slackOwnerNeedsReconnect = providerRoleOwnerNeedsReconnect(
        slackRoleStatus,
        setupMode,
    );
    const discordOwnerNeedsReconnect = providerRoleOwnerNeedsReconnect(
        discordRoleStatus,
        setupMode,
    );
    const slackSetupDetail =
        slackConnected && slackOwnerNeedsReconnect
            ? 'Owner reconnect required'
            : slackConnected
              ? 'Connected'
            : slackConfigured
              ? 'Ready to install'
              : 'Missing app settings';
    const discordSetupDetail =
        discordConnected && discordOwnerNeedsReconnect
            ? 'Owner reconnect required'
            : discordConnected
              ? 'Connected'
            : discordConfigured
              ? 'Ready to install'
              : 'Missing app settings';

    shell(`
    ${settingsNotice}
    ${sessionFeedbackHtml()}
    <section class="page-head console-head">
      <div>
        <p class="eyebrow">Setup</p>
        <h1>${escapeHtml(settingsLabel)}</h1>
        <p>Connect the services ${escapeHtml(runtimeLabel)} needs to ${isTeamDistribution ? 'watch messages' : 'receive DMs to your personal bot'} and draft useful replies.</p>
      </div>
      ${consoleStateHtml(setup.provider.configured && channelConnected ? 'Operational' : 'Needs setup', setup.provider.configured && channelConnected ? 'ok' : 'off')}
    </section>

    <dl class="kpis">
      ${workspaceMetric(workspaces, { personal: !isTeamDistribution })}
      ${metric('AI provider', setup.provider.configured ? `${setup.provider.defaultProvider}` : 'Not configured')}
      ${metric('Slack', slackConnected ? 'Connected' : 'Not connected')}
      ${metric('Discord', discordConnected ? 'Connected' : 'Not connected')}
    </dl>

    <section class="grid three service-grid setup-entry-grid">
      <article class="panel panel-status setup-entry-card">
        <h2><span class="status-dot ${slackConnected ? 'ok' : 'off'}" aria-hidden="true"></span>Slack</h2>
        <p>Launch the guided setup for Slack ${isTeamDistribution ? 'channel' : 'owner-DM'} coverage.</p>
        <dl class="details">
          <div><dt>Status</dt><dd>${slackConnected ? 'Connected' : 'Not connected'}</dd></div>
          <div><dt>Coverage</dt><dd>${escapeHtml(providerModeSummary(setup, 'slack'))}</dd></div>
          <div><dt>Events</dt><dd>${setup.slack.eventsMode === 'socket' ? 'Socket Mode' : 'HTTP'}</dd></div>
          <div><dt>DM shortcut</dt><dd>${(slackRoleStatus?.socketConfigured ?? setup.slack.socketConfigured) ? 'Socket Mode' : 'Needs app token'}</dd></div>
          <div><dt>Setup</dt><dd>${slackSetupDetail}</dd></div>
        </dl>
        <div class="actions">
          <a class="button" href="/setup?provider=slack&mode=${setupMode}">${slackConnected ? 'Reconnect Slack' : 'Connect Slack'}</a>
          <button type="button" class="secondary manage-provider-modes" data-provider="slack">Coverage</button>
        </div>
      </article>
      <article class="panel panel-status setup-entry-card">
        <h2><span class="status-dot ${discordConnected ? 'ok' : 'off'}" aria-hidden="true"></span>Discord</h2>
        <p>Launch the guided setup for Discord ${isTeamDistribution ? 'channel' : 'owner-DM'} coverage.</p>
        <dl class="details">
          <div><dt>Status</dt><dd>${discordConnected ? 'Connected' : 'Not connected'}</dd></div>
          <div><dt>Coverage</dt><dd>${escapeHtml(providerModeSummary(setup, 'discord'))}</dd></div>
          <div><dt>DM shortcut</dt><dd>${setup.discord.publicKeyConfigured ? 'Ready' : 'Missing public key'}</dd></div>
          <div><dt>Setup</dt><dd>${discordSetupDetail}</dd></div>
        </dl>
        <div class="actions">
          <a class="button" href="/setup?provider=discord&mode=${setupMode}">${discordConnected ? 'Reconnect Discord' : 'Connect Discord'}</a>
          <button type="button" class="secondary manage-provider-modes" data-provider="discord">Coverage</button>
        </div>
      </article>
      <article class="panel panel-status setup-entry-card">
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
              <dl class="details compact-details">
                <div><dt>Execution mode</dt><dd>${escapeHtml(policyExecutionModeLabel(policyConfig.mode))}</dd></div>
              </dl>
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
      <p class="section-copy">Connect optional sources ${escapeHtml(runtimeLabel)} can use for grounded replies.</p>
      ${
          selectedWorkspaceId
              ? `<div class="grid two">
            ${integrationsPayload.integrations.map((i) => integrationCard(i, integrationsPayload.workspaceId)).join('')}
          </div>`
              : '<p class="empty">Connect a Slack workspace or Discord server before adding sources.</p>'
      }
    </section>

    ${integrationCredentialDialog(integrationsPayload.workspaceId)}
    ${googleOAuthDialog(integrationsPayload.workspaceId)}
    ${policyProfileDialog(policyConfig.profiles, policyConfig.selectedProfileName)}
    ${providerModesDialog()}
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
            setDashboardNotice('Policy saved.');
            await renderSettings();
        },
    );

    app.querySelector<HTMLButtonElement>(
        '.open-policy-profiles',
    )?.addEventListener('click', () => {
        app.querySelector<HTMLDialogElement>(
            '#policy-profile-dialog',
        )?.showModal();
    });

    app.querySelectorAll<HTMLButtonElement>('.close-policy-profiles').forEach(
        (button) => {
            button.addEventListener('click', () => {
                app.querySelector<HTMLDialogElement>(
                    '#policy-profile-dialog',
                )?.close();
            });
        },
    );

    app.querySelectorAll<HTMLButtonElement>('.manage-provider-modes').forEach(
        (button) => {
            button.addEventListener('click', () => {
                const provider = button.dataset.provider ?? '';
                if (!isManagedProvider(provider)) return;
                const dialog = app.querySelector<HTMLDialogElement>(
                    '#provider-modes-dialog',
                );
                const form = app.querySelector<HTMLFormElement>(
                    '#provider-modes-form',
                );
                const listEl = app.querySelector<HTMLElement>(
                    '#provider-modes-list',
                );
                const eyebrowEl = app.querySelector<HTMLElement>(
                    '#provider-modes-eyebrow',
                );
                const titleEl = app.querySelector<HTMLElement>(
                    '#provider-modes-title',
                );
                const error = app.querySelector<HTMLElement>(
                    '#provider-modes-error',
                );
                if (!dialog || !form || !listEl) return;
                form.dataset.provider = provider;
                listEl.innerHTML = providerModeRows(setup, provider);
                if (eyebrowEl) eyebrowEl.textContent = providerLabel(provider);
                if (titleEl)
                    titleEl.textContent = `Manage ${providerLabel(provider)} coverage`;
                if (error) {
                    error.hidden = true;
                    error.textContent = '';
                }
                dialog.showModal();
            });
        },
    );

    app.querySelectorAll<HTMLButtonElement>('.close-provider-modes').forEach(
        (button) => {
            button.addEventListener('click', () => {
                app.querySelector<HTMLDialogElement>(
                    '#provider-modes-dialog',
                )?.close();
            });
        },
    );

    app.querySelector<HTMLDialogElement>(
        '#provider-modes-dialog',
    )?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) {
            (event.currentTarget as HTMLDialogElement).close();
        }
    });

    app.querySelector<HTMLFormElement>('#provider-modes-form')?.addEventListener(
        'submit',
        async (event) => {
            event.preventDefault();
            const form = event.currentTarget as HTMLFormElement;
            const provider = form.dataset.provider ?? '';
            if (!isManagedProvider(provider)) return;
            const roles = new FormData(form)
                .getAll('role')
                .filter((role): role is BotRole =>
                    distributionRoles(setup).includes(role as BotRole),
                );
            const error = form.querySelector<HTMLElement>(
                '#provider-modes-error',
            );
            const submitButton = form.querySelector<HTMLButtonElement>(
                'button[type="submit"]',
            );
            if (error) {
                error.hidden = true;
                error.textContent = '';
            }
            if (submitButton) submitButton.disabled = true;
            try {
                const providerBotRoles: Record<string, BotRole[]> = {
                    ...(setup.providerBotRoles ?? {}),
                    [provider]: roles,
                };
                await putJson('/api/setup/provider-roles', {
                    providerBotRoles,
                });
                setDashboardNotice(
                    roles.length === 0
                        ? `${providerLabel(provider)} coverage turned off.`
                        : `${providerLabel(provider)} coverage updated.`,
                );
                app.querySelector<HTMLDialogElement>(
                    '#provider-modes-dialog',
                )?.close();
                await renderSettings();
            } catch (errorValue) {
                if (error) {
                    error.textContent =
                        errorValue instanceof Error
                            ? errorValue.message
                            : 'Coverage could not be saved.';
                    error.hidden = false;
                }
                if (submitButton) submitButton.disabled = false;
            }
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
        const filterInput = picker?.querySelector<HTMLInputElement>(
            '.github-repo-filter',
        );
        const error = picker?.querySelector<HTMLElement>('#github-repo-error');
        if (!picker || !listEl || !saveButton) return;

        listEl.innerHTML = '<p class="empty">Loading repositories...</p>';
        saveButton.disabled = true;
        if (filterInput) filterInput.value = '';
        if (error) {
            error.hidden = true;
            error.textContent = '';
        }
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
                const selectedCount = listEl.querySelectorAll<HTMLInputElement>(
                    'input[name="githubRepository"]:checked',
                ).length;
                saveButton.disabled = selectedCount === 0;
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
            const filter = () => {
                const query = filterInput?.value.trim().toLowerCase() ?? '';
                listEl
                    .querySelectorAll<HTMLLabelElement>('.channel-item')
                    .forEach((item) => {
                        item.hidden =
                            query.length > 0 &&
                            !item.textContent?.toLowerCase().includes(query);
                    });
            };
            listEl
                .querySelectorAll<HTMLInputElement>(
                    'input[name="githubRepository"]',
                )
                .forEach((input) => {
                    input.addEventListener('change', sync);
                });
            filterInput?.addEventListener('input', filter);
            sync();
        } catch (error) {
            listEl.innerHTML = `<p class="empty">${escapeHtml(error instanceof Error ? error.message : 'Could not load GitHub repositories.')}</p>`;
        }
    }

    app.querySelector<HTMLButtonElement>(
        '.manage-github-repos',
    )?.addEventListener('click', async () => {
        const dialog = app.querySelector<HTMLDialogElement>(
            '#integration-credential-dialog',
        );
        const form = app.querySelector<HTMLFormElement>(
            '#integration-credential-form',
        );
        const repoStep = app.querySelector<HTMLElement>(
            '#integration-github-repo-step',
        );
        const providerEl = app.querySelector<HTMLElement>(
            '#integration-credential-provider',
        );
        const titleEl = app.querySelector<HTMLElement>(
            '#integration-credential-title',
        );
        const descriptionEl = app.querySelector<HTMLElement>(
            '#integration-credential-description',
        );
        if (form) form.hidden = true;
        if (repoStep) repoStep.hidden = false;
        if (providerEl) providerEl.textContent = 'GitHub';
        if (titleEl) titleEl.textContent = 'Choose repositories';
        if (descriptionEl)
            descriptionEl.textContent =
                'Choose the repositories Murph can search when grounding replies with GitHub context.';
        dialog?.showModal();
        await loadGithubRepositories();
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
                const error =
                    picker.querySelector<HTMLElement>('#github-repo-error');
                if (repositories.length === 0) {
                    if (error) {
                        error.textContent =
                            'Choose at least one repository before enabling GitHub retrieval.';
                        error.hidden = false;
                    }
                    return;
                }
                if (error) {
                    error.hidden = true;
                    error.textContent = '';
                }
                button.disabled = true;
                try {
                    await putJson('/api/integrations/github/repositories', {
                        workspaceId,
                        repositories,
                    });
                    setDashboardNotice(
                        repositories.length === 1
                            ? 'GitHub connected with 1 repository.'
                            : `GitHub connected with ${repositories.length} repositories.`,
                    );
                    app.querySelector<HTMLDialogElement>(
                        '#integration-credential-dialog',
                    )?.close();
                    await renderSettings();
                } catch (errorValue) {
                    if (error) {
                        error.textContent =
                            errorValue instanceof Error
                                ? errorValue.message
                                : 'Could not save GitHub repositories.';
                        error.hidden = false;
                    }
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
                const repoStep = app.querySelector<HTMLElement>(
                    '#integration-github-repo-step',
                );
                if (providerInput) providerInput.value = provider;
                if (credentialInput) {
                    credentialInput.value = '';
                    credentialInput.type =
                        integration.authType === 'path' ? 'text' : 'password';
                    credentialInput.placeholder =
                        integration.authType === 'path'
                            ? '/Users/you/Documents/Obsidian Vault'
                            : '';
                }
                form.hidden = false;
                if (repoStep) repoStep.hidden = true;
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
                    hintEl.textContent =
                        integration.authType === 'path'
                            ? `Stored in Murph's local config and available to all channel workspaces. ${integration.envKey} still works as a server env override.`
                            : `Stored locally for Murph and available to all channel workspaces. ${integration.envKey} still works as a server env override.`;
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
                    ...(integration.authType === 'path'
                        ? { vaultPath: credential }
                        : { credential }),
                },
            );
            if (provider === 'github') {
                const titleEl = app.querySelector<HTMLElement>(
                    '#integration-credential-title',
                );
                const descriptionEl = app.querySelector<HTMLElement>(
                    '#integration-credential-description',
                );
                const repoStep = app.querySelector<HTMLElement>(
                    '#integration-github-repo-step',
                );
                if (titleEl) titleEl.textContent = 'Choose repositories';
                if (descriptionEl) {
                    descriptionEl.textContent =
                        'Choose at least one repository so Murph can ground GitHub answers without broad search fanout.';
                }
                form.hidden = true;
                if (repoStep) repoStep.hidden = false;
                if (submitButton) submitButton.disabled = false;
                await loadGithubRepositories();
                return;
            }
            setDashboardNotice(`Connected ${integration.name}.`);
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
                await deleteJson(disconnectUrl);
                setDashboardNotice(`Disconnected ${name}.`);
                await renderSettings();
            });
        },
    );
}
