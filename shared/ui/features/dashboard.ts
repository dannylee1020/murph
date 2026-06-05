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
    formatExactIso,
    titleCase
} from '../shared/format';
import { ApiError, getJson, postJson, putJson } from '../shared/api';
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
    getTimezoneOptions,
    googleOAuthDialog,
    homeChannelGroups,
    homeCoverageSummaryHtml,
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

export async function renderDashboard(): Promise<void> {
    setTitle('Murph');
    loading('Home');
    const [data, setupStatus, setupDefaults, policyConfig] = await Promise.all([
        getJson<SummaryPayload>('/api/gateway/summary'),
        getJson<SetupStatusPayload>('/api/setup/status'),
        getJson<SetupDefaultsPayload>('/api/setup/defaults'),
        getJson<PolicyConfigPayload>('/api/gateway/policy/config'),
    ]);
    setSidebarWatchingCount(data.summary.activeSessionCount);
    const isPersonal = false;

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
                if (!isPersonal) {
                    try {
                        const channelsPayload =
                            await getJson<SetupChannelsPayload>(
                                `/api/setup/channels?workspaceId=${encodeURIComponent(workspace.id)}`,
                            );
                        availableChannels = channelsPayload.channels ?? [];
                    } catch (error) {
                        channelLoadError =
                            error instanceof Error
                                ? error.message
                                : 'Murph could not load channels right now.';
                    }
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
                    ? [
                          {
                              id: selectedOwnerId,
                              displayName: defaultOwner.name || selectedOwnerId,
                          },
                      ]
                    : [];
                if (isPersonal || channelLoadError || availableChannels.length === 0) {
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
    const userTz = currentUser?.schedule?.timezone ?? DEFAULT_HOME_TIMEZONE;
    const userStartHour =
        currentUser?.schedule?.workdayStartHour ??
        DEFAULT_HOME_WORKDAY_START_HOUR;
    const estimatedHours = calculateDurationHours(userStartHour, userTz);
    const policyModeLabel = policyExecutionModeLabel(policyConfig.mode);
    const hasActiveSessions = data.sessions.length > 0;
    const watchButtonLabel = hasActiveSessions
        ? isPersonal
            ? 'Stop DM coverage'
            : 'Stop watching'
        : isPersonal
          ? 'Start DM coverage'
          : 'Start watching';
    const providerBanner = !setupStatus.provider.configured
        ? `<div class="setup-banner">
        <p>Connect an AI provider to let Murph draft replies for you.</p>
        <a class="button secondary" href="/admin">Configure</a>
      </div>`
        : '';
    const ownerNotice = missingOwnerNotice(channelStates, {
        personal: isPersonal,
    });

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
        <p>${isPersonal ? 'Murph will receive DMs to your personal bot using your policy default.' : 'Murph will watch your accessible channels using your policy default.'}</p>
        <form id="go-to-sleep-form">
          <dl class="go-to-sleep-summary">
            <div class="summary-cell">
              <dt>${isPersonal ? 'Coverage' : 'Watching'}</dt>
              <dd class="coverage-summary-value">${homeCoverageSummaryHtml(channelStates, { personal: isPersonal })}</dd>
            </div>
            <div class="summary-cell">
              <dt>Until</dt>
              <dd>${String(userStartHour).padStart(2, '0')}:00 ${escapeHtml(userTz.split('/').pop()?.replace(/_/g, ' ') ?? userTz)} (~${estimatedHours}h)</dd>
            </div>
            <div class="summary-cell">
              <dt>Mode</dt>
              <dd>${escapeHtml(policyModeLabel)}</dd>
            </div>
          </dl>
          ${ownerNotice}
          <button type="submit" class="primary-large">${watchButtonLabel}</button>

          <details class="customize-section">
            <summary>Customize</summary>
            ${homeChannelGroups(channelStates, { personal: isPersonal })}
            <fieldset class="customize-fieldset">
              <legend>Session mode</legend>
              <div class="mode-selector">
                <label class="mode-radio">
                  <input type="radio" name="mode" value="" checked />
                  <span class="mode-label">Use policy default</span>
                  <span class="mode-description">${escapeHtml(policyModeLabel)}</span>
                </label>
                <label class="mode-radio">
                  <input type="radio" name="mode" value="manual_review" />
                  <span class="mode-label">Review everything tonight</span>
                  <span class="mode-description">Temporary override for this session</span>
                </label>
                <label class="mode-radio">
                  <input type="radio" name="mode" value="dry_run" />
                  <span class="mode-label">Practice run</span>
                  <span class="mode-description">Simulate without actually sending anything</span>
                </label>
              </div>
            </fieldset>
            <fieldset class="customize-fieldset">
              <legend>${isPersonal ? 'Stop receiving DMs at' : 'Stop watching at'}</legend>
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
            <h2>${isPersonal ? 'Current DM coverage' : 'Currently watching'}</h2>
            <span class="section-meta">${escapeHtml(formatSessionStatus(data.summary.activeSessionCount))}</span>
          </div>
          ${activeSessionRows(data.sessions, selectedChannelNames, workspaceNames, { personal: isPersonal })}
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
                (group?.querySelector<HTMLInputElement>(
                    `input[name="channelScopeMode:${state.workspace.id}"]:checked`,
                ) ??
                    group?.querySelector<HTMLInputElement>(
                        `input[name="channelScopeMode:${state.workspace.id}"]`,
                    ))?.value === 'all_accessible'
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
            const label = channelSummaryLabel(mode, currentChannels, {
                personal: isPersonal,
            });
            const toggleLabel = group?.querySelector<HTMLElement>(
                '.workspace-channel-scope',
            );
            if (toggleLabel)
                toggleLabel.textContent = enabled
                    ? label
                    : isPersonal
                      ? 'Not receiving DMs'
                      : 'Not watched';
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
            summaryCell.innerHTML = homeCoverageSummaryHtml(nextStates, {
                personal: isPersonal,
            });
        const submitButton = form.querySelector<HTMLButtonElement>(
            'button[type="submit"]',
        );
        if (submitButton) {
            const enabledStates = nextStates.filter((state) => state.enabled);
            submitButton.disabled =
                !hasActiveSessions &&
                (enabledStates.length === 0 ||
                    enabledStates.some((state) => !state.selectedOwnerId) ||
                    enabledStates.some(
                        (state) =>
                            state.mode === 'selected' &&
                            state.selectedChannels.length === 0,
                    ));
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
                        error instanceof Error
                            ? error.message
                            : 'Could not save';
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
            if (hasActiveSessions) {
                await Promise.all(
                    data.sessions.map((session) =>
                        postJson(`/api/gateway/sessions/${session.id}/stop`),
                    ),
                );
                setDashboardNotice(
                    data.sessions.length === 1
                        ? 'Session stopped.'
                        : 'Sessions stopped.',
                );
                await renderDashboard();
                return;
            }

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
                const payload: Record<string, unknown> = {
                    ownerUserId: currentUserId,
                    title: isPersonal
                        ? 'DM coverage overnight'
                        : 'Watching overnight',
                    stopLocalTime: endTimeVal,
                    timezone: tz,
                    targets: targets.map((target) => ({
                        workspaceId: target.workspaceId,
                        ownerUserId: target.ownerUserId,
                        channelScope: target.channelScope,
                    })),
                };
                if (mode) {
                    payload.mode = mode;
                }
                await postJson<SessionCreateResponse>(
                    '/api/gateway/sessions/bulk',
                    payload,
                );
                clearDashboardError();
                setDashboardNotice(
                    targets.length > 1
                        ? isPersonal
                            ? `Murph is receiving DMs through ${targets.map((target) => providerLabel(target.workspace.provider)).join(' and ')}.`
                            : `Murph is watching ${targets.map((target) => providerLabel(target.workspace.provider)).join(' and ')}.`
                        : isPersonal
                          ? 'Murph is receiving DMs.'
                          : 'Murph is watching.',
                );
                await renderDashboard();
            } catch (error) {
                if (error instanceof ApiError) {
                    clearDashboardNotice();
                    setDashboardError(
                        sessionCreateErrorHtml(
                            error.payload as SessionCreateResponse,
                        ),
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
                setDashboardNotice('Session stopped.');
                await renderDashboard();
            });
        },
    );
}
