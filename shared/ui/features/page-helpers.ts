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

let dashboardNotice = '';
let dashboardError = '';

export function setDashboardNotice(notice: string): void {
    dashboardNotice = notice;
}

export function clearDashboardNotice(): void {
    dashboardNotice = '';
}

export function setDashboardError(error: string): void {
    dashboardError = error;
}

export function clearDashboardError(): void {
    dashboardError = '';
}
export const ADMIN_WORKSPACE_STORAGE_KEY = 'murph_admin_workspace_id';
export const HOME_WORKSPACE_STORAGE_KEY = 'murph_home_workspace_id';
export const DEFAULT_HOME_TIMEZONE =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
export const DEFAULT_HOME_WORKDAY_START_HOUR = 9;

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

type ContextRetrievalEntry = {
    name: string;
    artifacts: number;
    titles: string[];
    status: 'ok' | 'empty' | 'error';
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : undefined;
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
}

function contextRetrievalName(name: string): string {
    return name.endsWith('.thread_search') || name.endsWith('.upcoming_events')
        ? name.split('.')[0] ?? name
        : name;
}

function mergeContextRetrievalEntry(
    entries: Map<string, ContextRetrievalEntry>,
    name: string,
    update?: Partial<Omit<ContextRetrievalEntry, 'name'>>,
): void {
    const normalizedName = contextRetrievalName(name);
    const existing = entries.get(normalizedName) ?? {
        name: normalizedName,
        artifacts: 0,
        titles: [],
        status: 'empty' as const,
    };
    const titles = [
        ...existing.titles,
        ...(update?.titles ?? []),
    ].filter((title, index, all) => title && all.indexOf(title) === index);
    entries.set(normalizedName, {
        ...existing,
        ...update,
        artifacts: Math.max(existing.artifacts, update?.artifacts ?? 0),
        titles: titles.slice(0, 5),
        status:
            update?.status ??
            (Math.max(existing.artifacts, update?.artifacts ?? 0) > 0
                ? 'ok'
                : existing.status),
    });
}

function contextSourceNamesFromPayload(payload: Record<string, unknown>): string[] {
    const sources = asRecord(payload.contextSources);
    if (!sources) return [];
    return [
        ...stringArray(sources.explicit),
        ...stringArray(sources.optional),
    ].filter((name, index, all) => all.indexOf(name) === index);
}

function artifactSourcesFromPayload(
    payload: Record<string, unknown>,
): Array<{ name: string; artifacts: number; titles: string[] }> {
    if (!Array.isArray(payload.artifactSources)) return [];
    return payload.artifactSources
        .map((entry) => {
            const record = asRecord(entry);
            if (!record || typeof record.name !== 'string') return undefined;
            return {
                name: record.name,
                artifacts:
                    typeof record.artifacts === 'number'
                        ? record.artifacts
                        : 0,
                titles: stringArray(record.titles),
            };
        })
        .filter(
            (
                entry,
            ): entry is { name: string; artifacts: number; titles: string[] } =>
                Boolean(entry),
        );
}

function artifactSourcesFromIndexSource(
    payload: Record<string, unknown>,
): Array<{ name: string; artifacts: number; titles: string[] }> {
    if (!Array.isArray(payload.artifacts)) return [];
    const grouped = new Map<
        string,
        { name: string; artifacts: number; titles: string[] }
    >();
    for (const artifact of payload.artifacts) {
        const record = asRecord(artifact);
        if (!record || typeof record.source !== 'string') continue;
        if (record.source.startsWith('memory.')) continue;
        const existing = grouped.get(record.source) ?? {
            name: record.source,
            artifacts: 0,
            titles: [],
        };
        existing.artifacts += 1;
        if (typeof record.title === 'string' && existing.titles.length < 5) {
            existing.titles.push(record.title);
        }
        grouped.set(record.source, existing);
    }
    return [...grouped.values()];
}

export function contextRetrievalEntries(
    events: RunEventsPayload['events'],
): ContextRetrievalEntry[] {
    const entries = new Map<string, ContextRetrievalEntry>();
    for (const event of events) {
        const payload = asRecord(event.payload);
        if (!payload) continue;
        if (event.type === 'agent.context.built') {
            for (const name of contextSourceNamesFromPayload(payload)) {
                mergeContextRetrievalEntry(entries, name);
            }
            for (const source of artifactSourcesFromPayload(payload)) {
                mergeContextRetrievalEntry(entries, source.name, {
                    artifacts: source.artifacts,
                    titles: source.titles,
                    status: source.artifacts > 0 ? 'ok' : 'empty',
                });
            }
        } else if (event.type === 'agent.memory.index_source') {
            for (const source of artifactSourcesFromIndexSource(payload)) {
                mergeContextRetrievalEntry(entries, source.name, {
                    artifacts: source.artifacts,
                    titles: source.titles,
                    status: source.artifacts > 0 ? 'ok' : 'empty',
                });
            }
        } else if (event.type === 'agent.memory.written') {
            for (const name of stringArray(payload.successfulTools)) {
                mergeContextRetrievalEntry(entries, name, { status: 'ok' });
            }
            for (const name of stringArray(payload.failedTools)) {
                mergeContextRetrievalEntry(entries, name, { status: 'error' });
            }
        } else if (event.type === 'agent.memory.skipped') {
            for (const name of stringArray(payload.failedTools)) {
                mergeContextRetrievalEntry(entries, name, { status: 'error' });
            }
        }
    }
    return [...entries.values()];
}

export function pairToolCalls(events: RunEventsPayload['events']): ToolCallEntry[] {
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

export function formatToolDuration(ms: number | undefined): string {
    if (ms === undefined || !Number.isFinite(ms)) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
}

export function statusPillForTool(call: ToolCallEntry): string {
    if (call.status === 'ok') return '<span class="pill pill-ok">OK</span>';
    if (call.status === 'error')
        return '<span class="pill pill-warn">Error</span>';
    return '<span class="pill pill-muted">Pending</span>';
}

function statusPillForContext(entry: ContextRetrievalEntry): string {
    if (entry.status === 'ok') return '<span class="pill pill-ok">OK</span>';
    if (entry.status === 'error')
        return '<span class="pill pill-warn">Error</span>';
    return '<span class="pill pill-muted">No artifacts</span>';
}

function renderContextRetrievalEntry(entry: ContextRetrievalEntry): string {
    const rows = [
        `<div><dt>Artifacts</dt><dd>${escapeHtml(String(entry.artifacts))}</dd></div>`,
    ];
    if (entry.titles.length > 0) {
        rows.push(
            `<div><dt>Sources</dt><dd><ul>${entry.titles
                .map((title) => `<li>${escapeHtml(title)}</li>`)
                .join('')}</ul></dd></div>`,
        );
    }
    return `
    <li>
      <details class="tool-call">
        <summary>
          <span aria-hidden="true"></span>
          <span class="tool-call-name">${escapeHtml(entry.name)}</span>
          ${statusPillForContext(entry)}
          <span class="tool-call-duration">${escapeHtml(
              `${entry.artifacts} artifact${entry.artifacts === 1 ? '' : 's'}`,
          )}</span>
        </summary>
        <dl class="tool-call-body">
          ${rows.join('')}
        </dl>
      </details>
    </li>
  `;
}

export function renderContextRetrievalDisclosure(
    events: RunEventsPayload['events'],
): string {
    const entries = contextRetrievalEntries(events);
    const artifactCount = entries.reduce(
        (total, entry) => total + entry.artifacts,
        0,
    );
    const errorCount = entries.filter((entry) => entry.status === 'error').length;
    const meta =
        errorCount > 0
            ? `${entries.length} · ${errorCount} error${errorCount === 1 ? '' : 's'}`
            : `${String(entries.length).padStart(2, '0')} · ${artifactCount} artifact${artifactCount === 1 ? '' : 's'}`;

    return `
    <section>
      <details class="disclosure">
        <summary>
          <span>
            <span class="disclosure-label">Context retrieval</span>
            <span class="disclosure-count">${escapeHtml(meta)}</span>
          </span>
        </summary>
        ${
            entries.length === 0
                ? '<p class="disclosure-empty">No context-source retrieval recorded for this run.</p>'
                : `<ul class="tool-call-list">${entries.map(renderContextRetrievalEntry).join('')}</ul>`
        }
      </details>
    </section>
  `;
}

export function renderToolCallEntry(call: ToolCallEntry): string {
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

export function renderToolCallsDisclosure(events: RunEventsPayload['events']): string {
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

export function sessionModeLabel(mode: string): string {
    if (mode === 'manual_review') return 'Manual review';
    if (mode === 'dry_run') return 'Dry run';
    if (mode === 'auto_send_low_risk') return 'Low-risk auto-send';
    return titleCase(mode);
}

export function policyExecutionModeLabel(mode: string): string {
    if (mode === 'auto_send_low_risk') return 'Auto-handle routine stuff';
    return 'Show me drafts first';
}

export function policyProfileOptions(
    profiles: PolicyProfilesPayload['profiles'],
    selected: string | undefined,
): string {
    if (profiles.length === 0) {
        return '<option value="" disabled selected>No profiles found</option>';
    }

    const selectedProfile =
        selected && profiles.some((profile) => profile.name === selected)
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

export function policySummary(
    profileName: string,
    profileDescription: string | undefined,
    compiled: CompiledPolicyPayload,
): string {
    const rows = [
        ['Selected profile', profileName],
        ['Execution mode', policyExecutionModeLabel(compiled.executionMode)],
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

export function policyProfileList(
    profiles: PolicyProfilesPayload['profiles'],
    selectedProfileName: string,
): string {
    if (profiles.length === 0) {
        return '<p class="empty">No policy profiles were found in <code>policies/</code>.</p>';
    }

    return `
    <ul class="list policy-profile-list">
      ${profiles
          .map((profile) => {
              const selected = profile.name === selectedProfileName;
              return `
        <li>
          <div class="list-row policy-profile-row" ${selected ? 'aria-current="true"' : ''}>
            <strong>${escapeHtml(profile.name)}${selected ? '<span class="policy-current-label">Current</span>' : ''}</strong>
            <span>${escapeHtml(profile.description)}</span>
          </div>
        </li>
      `;
          })
          .join('')}
    </ul>
  `;
}

export function policyProfileDialog(
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

export function channelName(item: ChannelActionItem): string {
    return item.name ? `#${item.name}` : item.id;
}

export function sessionFeedbackHtml(): string {
    if (!dashboardNotice) {
        return '';
    }
    const notice = dashboardNotice;
    dashboardNotice = '';
    return `<div class="notice success">${escapeHtml(notice)}</div>`;
}

export function sessionErrorHtml(): string {
    if (!dashboardError) {
        return '';
    }
    const error = dashboardError;
    dashboardError = '';
    return error;
}

export function sessionCreateErrorHtml(payload: SessionCreateResponse): string {
    if (payload.targets?.length) {
        const hasChannelActionTarget = payload.targets.some(
            (target) => target.error === 'channels_require_action',
        );
        return `
      <div class="notice danger">
        <strong>${hasChannelActionTarget ? 'Channel access required' : 'Could not start watching'}</strong>
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
        <a class="button" href="/api/slack/install?source=settings">Reconnect Slack</a>
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

export function sessionCreateErrorDetails(payload: SessionCreateResponse): string {
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
    const reinstallRows = (payload.reinstallRequiredChannels ?? [])
        .map(
            (item) => `
        <div class="action-row">
          <span>${escapeHtml(channelName(item))}</span>
          <code>${escapeHtml(item.reason ?? 'Slack app scopes need to be updated')}</code>
        </div>
      `,
        )
        .join('');
    const hasDetails = Boolean(payload.reinstallRequired || inviteRows || reinstallRows || errorRows);
    const fallbackMessage =
        payload.message ??
        (payload.error === 'subscription_channel_scope_mismatch'
            ? 'The selected scope does not match the saved setup. Save the defaults and try again.'
            : undefined) ??
        (payload.error === 'subscription_required'
            ? 'This user is not subscribed in the selected workspace.'
            : undefined) ??
        (payload.error === 'owner_required'
            ? 'Choose an owner before starting this session.'
            : undefined) ??
        (payload.error === 'workspace_not_installed'
            ? 'Connect this workspace before starting a watch session.'
            : undefined) ??
        payload.error ??
        'Murph could not start this session.';

    return `
    ${
        payload.reinstallRequired
            ? '<p>The Slack app needs the latest channel scopes before this session can start.</p><a class="button" href="/api/slack/install?source=settings">Reinstall Slack app</a>'
            : ''
    }
    ${inviteRows ? `<div class="action-list">${inviteRows}</div>` : ''}
    ${reinstallRows ? `<div class="action-list">${reinstallRows}</div>` : ''}
    ${errorRows ? `<div class="action-list">${errorRows}</div>` : ''}
    ${
        hasDetails
            ? ''
            : `<p>${escapeHtml(fallbackMessage)}</p>`
    }
  `;
}

export function metric(label: string, value: string | number): string {
    return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}



type SavedHomeWorkspaceTarget = {
    workspace: ChannelWorkspace;
    mode: 'selected' | 'all_accessible';
    selectedChannels: Array<{ id: string; displayName: string }>;
};

export function savedHomeWorkspaceTargets(
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

export function resolveAdminWorkspaceId(workspaces: ChannelWorkspace[]): string {
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

export function workspaceMetric(
    workspaces: ChannelWorkspace[],
    options: { personal?: boolean } = {},
): string {
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
            <small>${escapeHtml(channelSummaryLabel(target.mode, target.selectedChannels, options))}</small>
          </span>
        `,
            )
            .join('')}
      </dd>
    </div>
  `;
}

export function channelSummaryLabel(
    mode: 'selected' | 'all_accessible',
    channels: Array<{ id: string; displayName: string }>,
    options: { personal?: boolean } = {},
): string {
    if (options.personal) {
        return 'Owner DMs';
    }
    if (mode === 'all_accessible' || channels.length === 0) {
        return 'All accessible channels';
    }
    if (channels.length === 1) {
        return channels[0].displayName;
    }
    return `${channels.length} channels`;
}

export function channelDisplayLabel(item: {
    channelId: string;
    channelDisplay?: { label?: string };
}): string {
    return item.channelDisplay?.label || item.channelId;
}

export function channelDisplayTitle(item: {
    channelId: string;
    channelDisplay?: { workspaceName?: string };
}): string {
    const parts = [item.channelId];
    if (item.channelDisplay?.workspaceName) {
        parts.push(item.channelDisplay.workspaceName);
    }
    return parts.join(' · ');
}

export function ownerDisplayName(ownerId: string, members: MemberChoice[]): string {
    return (
        members.find((member) => member.id === ownerId)?.displayName ?? ownerId
    );
}

export function combinedChannelSummary(
    states: HomeWorkspaceChannelState[],
    options: { personal?: boolean } = {},
): string {
    const enabled = states.filter((state) => state.enabled);
    if (enabled.length === 0) {
        return options.personal ? 'No personal bots connected' : 'No channels selected';
    }
    if (options.personal) {
        return enabled
            .map((state) => `${providerLabel(state.workspace.provider)} · Owner DMs`)
            .join(' + ');
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

export function homeCoverageSummaryHtml(
    states: HomeWorkspaceChannelState[],
    options: { personal?: boolean } = {},
): string {
    const enabled = states.filter((state) => state.enabled);
    if (enabled.length === 0) {
        return `<span>${escapeHtml(options.personal ? 'No personal bots connected' : 'No channels selected')}</span>`;
    }

    const providerNames = enabled
        .map((state) => providerLabel(state.workspace.provider))
        .join(' + ');
    const scope = options.personal
        ? 'Owner DMs'
        : enabled.length === 1
          ? channelSummaryLabel(enabled[0].mode, enabled[0].selectedChannels)
          : enabled.every((state) => state.mode === 'all_accessible')
            ? 'All accessible channels'
            : `${enabled.reduce(
                  (count, state) =>
                      count +
                      (state.mode === 'selected'
                          ? state.selectedChannels.length
                          : 0),
                  0,
              )} selected channels`;

    return `
      <span>${escapeHtml(providerNames)}</span>
      <small>${escapeHtml(scope)}</small>
    `;
}

export function missingOwnerNotice(
    states: HomeWorkspaceChannelState[],
    options: { personal?: boolean } = {},
): string {
    const missing = states.filter(
        (state) => state.enabled && !state.selectedOwnerId,
    );
    if (missing.length === 0) return '';

    const discordMissing = missing.find(
        (state) => state.workspace.provider === 'discord',
    );
    if (discordMissing) {
        return `
      <div class="notice warning">
        <strong>Discord owner required</strong>
        <p>Run <code>murph setup discord</code> to identify the Discord account Murph should ${options.personal ? 'receive DMs for' : 'watch for'} ${escapeHtml(discordMissing.workspace.name)}.</p>
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

export function homeChannelGroup(
    state: HomeWorkspaceChannelState,
    options: { personal?: boolean } = {},
): string {
    const selected = new Set(
        state.selectedChannels.map((channel) => channel.id),
    );
    const label = channelSummaryLabel(
        state.mode,
        state.selectedChannels,
        options,
    );
    const allSelected = state.mode === 'all_accessible';
    const workspaceId = state.workspace.id;
    if (options.personal) {
        return `
    <section class="workspace-channel-group ${state.enabled ? '' : 'disabled'}" data-workspace-id="${escapeHtml(workspaceId)}">
      <div class="workspace-channel-header">
        <label class="workspace-channel-toggle">
          <input type="checkbox" name="workspaceTarget" value="${escapeHtml(workspaceId)}" ${state.enabled ? 'checked' : ''} />
          <input type="hidden" name="channelScopeMode:${escapeHtml(workspaceId)}" value="all_accessible" />
          <input type="hidden" name="workspaceOwner:${escapeHtml(workspaceId)}" value="${escapeHtml(state.selectedOwnerId)}" />
          <span>
            <strong>${escapeHtml(workspaceOptionLabel(state.workspace))}</strong>
            <small class="workspace-channel-scope">${escapeHtml(state.enabled ? label : 'Not receiving DMs')}</small>
          </span>
        </label>
      </div>
    </section>
  `;
    }
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

export function homeChannelGroups(
    states: HomeWorkspaceChannelState[],
    options: { personal?: boolean } = {},
): string {
    return `
    <fieldset class="customize-fieldset home-channel-fieldset">
      <legend>${options.personal ? 'DM inboxes' : 'Channels'}</legend>
      <div class="home-workspace-groups">
        ${
            states.length > 0
                ? states
                      .map((state) => homeChannelGroup(state, options))
                      .join('')
                : `<p class="empty">${options.personal ? 'Connect Slack or Discord to receive owner DMs.' : 'Connect Slack or Discord to choose channels.'}</p>`
        }
      </div>
    </fieldset>
  `;
}

export function list(items: string[], emptyText: string): string {
    if (items.length === 0) {
        return `<p class="empty">${escapeHtml(emptyText)}</p>`;
    }
    return `<ul class="list">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

export function sessionScopeLabel(
    session: SummaryPayload['sessions'][number],
    channelNames: Map<string, string>,
    workspaceNames: Map<string, string>,
    options: { personal?: boolean } = {},
): string {
    const scope = options.personal
        ? 'Owner DMs'
        : session.channelScope.length > 0
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

export function activeSessionRows(
    sessions: SummaryPayload['sessions'],
    channelNames: Map<string, string>,
    workspaceNames: Map<string, string>,
    options: { personal?: boolean } = {},
): string {
    if (sessions.length === 0) {
        return options.personal
            ? '<p class="empty">Murph is not receiving DMs right now.</p>'
            : '<p class="empty">Murph is not watching right now.</p>';
    }

    return `<ul class="list active-session-list">${sessions
        .map(
            (session) => `
        <li>
          <div class="list-row active-session-row">
            <strong>${escapeHtml(session.title)}</strong>
            <span>${escapeHtml(plainLanguageModeLabel(session.mode))}</span>
            <span title="${escapeHtml(formatExactIso(session.endsAt))}">Until ${escapeHtml(formatDateTime(session.endsAt))}</span>
            <span>${escapeHtml(sessionScopeLabel(session, channelNames, workspaceNames, options))}</span>
            <button class="secondary stop-session" data-session-id="${escapeHtml(session.id)}">Stop</button>
          </div>
        </li>
      `,
        )
        .join('')}</ul>`;
}

export function githubRepositorySummary(
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

export function integrationCredentialDialog(workspaceId: string): string {
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
        <div class="github-repo-step" id="integration-github-repo-step" hidden>
          <p class="modal-intro">Choose the repositories Murph can search when grounding replies with GitHub context.</p>
          <div class="github-repo-picker" data-workspace-id="${escapeHtml(workspaceId)}">
            <label class="github-repo-filter-label">
              <span>Filter repositories</span>
              <input type="search" class="github-repo-filter" placeholder="Search owner/repo" autocomplete="off" />
            </label>
            <div class="github-repo-list"><p class="empty">Repositories load after GitHub connects.</p></div>
            <p class="modal-error" id="github-repo-error" hidden></p>
            <div class="actions">
              <button type="button" class="secondary close-integration-credential">Cancel</button>
              <button type="button" class="save-github-repos" disabled>Save repositories</button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  `;
}

export function googleOAuthDialog(workspaceId: string): string {
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

export function integrationCard(
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
        } else if (
            integration.provider === 'obsidian' &&
            integration.metadata.vaultPath
        ) {
            detailRows.push(
                `<div><dt>Vault</dt><dd>${escapeHtml(integration.metadata.vaultPath)}</dd></div>`,
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
                : integration.authType === 'path'
                  ? 'Vault path'
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
      <div class="actions integration-actions">
        ${primaryCta}
        ${integration.canDisconnect ? `<button type="button" class="secondary disconnect-integration" data-provider="${escapeHtml(integration.provider)}">Disconnect</button>` : ''}
        ${connected && integration.provider === 'github' ? '<button type="button" class="secondary manage-github-repos" aria-label="Manage GitHub repositories">Manage repositories</button>' : ''}
      </div>
    </article>
  `;
}

export function plainLanguageModeLabel(mode: string): string {
    if (mode === 'manual_review') return 'Show me drafts first';
    if (mode === 'dry_run') return 'Practice run (won’t send anything)';
    if (mode === 'auto_send_low_risk') return 'Auto-handle routine stuff';
    return titleCase(mode);
}

export function getTimezoneOptions(): string[] {
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

export function timezoneLabel(tz: string): string {
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

export function calculateDurationHours(endHour: number, timezone: string): number {
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
