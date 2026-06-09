import {
    adminChannelWorkspaces,
    workspaceOptionLabel,
    channelBadge,
    defaultOwnerForWorkspace
} from '../lib/workspaces';
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
} from '../lib/shell';
import {
    providerLabel,
    roleLabel,
    roleDescription
} from '../lib/labels';
import {
    agentProvider,
    agentModel,
    runtimeModel,
    agentModelFields
} from '../lib/agent';
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
} from '../lib/storage';
import {
    escapeHtml,
    setTitle,
    formatToday,
    formatSessionStatus,
    formatRelative,
    formatDateTime,
    formatExactIso,
    titleCase
} from '../lib/format';
import { ApiError, getJson, postJson, putJson } from '../lib/api';
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
    SessionsPayload,
    AuditPayload,
    RunsPayload,
    RunEventsPayload,
    RecurringJobsPayload,
    ChannelActionItem,
    SessionCreateResponse,
    PolicyProfilesPayload,
    PolicyConfigPayload
} from '../lib/types';

import {
    ADMIN_WORKSPACE_STORAGE_KEY,
    HOME_WORKSPACE_STORAGE_KEY,
    DEFAULT_HOME_TIMEZONE,
    DEFAULT_HOME_WORKDAY_START_HOUR,
    activeSessionRows,
    calculateDurationHours,
    channelDisplayLabel,
    channelDisplayTitle,
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
export async function renderReview(): Promise<void> {
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
                    .map((item) => {
                        const channelLabel = channelDisplayLabel(item);
                        const channelTitle = channelDisplayTitle(item);
                        return `
                  <article class="panel draft-panel">
                    <h2><span title="${escapeHtml(channelTitle)}">${escapeHtml(channelLabel)}</span><code>${escapeHtml(item.threadTs)}</code></h2>
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
                `;
                    })
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

function runStatusTone(status: string): 'ok' | 'off' | 'warn' {
    if (status === 'completed') return 'ok';
    if (status === 'failed') return 'warn';
    return 'off';
}

function formatRunDuration(startedAt: string, completedAt?: string): string {
    if (!completedAt) return 'In progress';
    const elapsedMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '—';
    if (elapsedMs < 1000) return `${elapsedMs}ms`;
    const seconds = Math.round(elapsedMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

function runTargetLabel(run: RunsPayload['runs'][number]): string {
    return channelDisplayLabel(run);
}

function runRow(
    run: RunsPayload['runs'][number],
    selectedRunId: string | undefined,
    hrefBase: '/activity' | '/runs',
): string {
    const active = selectedRunId === run.id;
    const href = active ? hrefBase : `${hrefBase}?id=${encodeURIComponent(run.id)}`;
    const recorded = formatDateTime(run.startedAt).replace(',', ' ·');
    return `
    <li>
      <a
        class="list-row run-item ${active ? 'active' : ''}"
        data-link
        href="${escapeHtml(href)}"
        aria-expanded="${active ? 'true' : 'false'}"
        aria-controls="runtime-log-panel"
        ${active ? 'aria-current="page"' : ''}
      >
        <span class="run-item-body">
          <strong>${escapeHtml(runTargetLabel(run))}</strong>
          <span>Task ${escapeHtml(run.taskId.slice(0, 12))} · ${escapeHtml(recorded)}</span>
        </span>
        ${consoleStateHtml(titleCase(run.status), runStatusTone(run.status))}
      </a>
    </li>
  `;
}

function eventPayloadSummary(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return 'No payload retained.';
    const record = payload as Record<string, unknown>;
    const candidate =
        record.summary ??
        record.reason ??
        record.error ??
        record.message ??
        record.status ??
        record.name;
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    const keys = Object.keys(record);
    if (keys.length === 0) return 'Empty payload retained.';
    return `Payload retained with ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? `, and ${keys.length - 4} more` : ''}.`;
}

type RuntimeCheckpoint = {
    key: string;
    label: string;
    tone: 'ok' | 'off' | 'warn';
    at?: string;
    summary: string;
    meta?: string[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function eventPayload(
    event: RunEventsPayload['events'][number] | undefined,
): Record<string, unknown> {
    return asRecord(event?.payload) ?? {};
}

function firstRunEvent(
    events: RunEventsPayload['events'],
    type: string,
): RunEventsPayload['events'][number] | undefined {
    return events.find((event) => event.type === type);
}

function lastRunEvent(
    events: RunEventsPayload['events'],
    type: string,
): RunEventsPayload['events'][number] | undefined {
    return [...events].reverse().find((event) => event.type === type);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
    return values.filter(
        (value, index, all): value is string =>
            Boolean(value) && all.indexOf(value) === index,
    );
}

function valueLabel(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    return undefined;
}

function percentLabel(value: unknown): string | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? `${Math.round(value * 100)}%`
        : undefined;
}

function shortList(values: string[], empty: string): string {
    if (values.length === 0) return empty;
    if (values.length <= 2) return values.join(', ');
    return `${values.slice(0, 2).join(', ')} +${values.length - 2}`;
}

function finalPolicyEvent(
    events: RunEventsPayload['events'],
): RunEventsPayload['events'][number] | undefined {
    const policies = events.filter((event) => event.type === 'agent.policy.decided');
    return (
        [...policies]
            .reverse()
            .find((event) => eventPayload(event).phase !== 'execution_classifier') ??
        policies.at(-1)
    );
}

function buildRuntimeCheckpoints(
    run: RunsPayload['runs'][number],
    events: RunEventsPayload['events'],
): RuntimeCheckpoint[] {
    const started = firstRunEvent(events, 'agent.run.started');
    const context = firstRunEvent(events, 'agent.context.built');
    const model = lastRunEvent(events, 'agent.model.completed');
    const modelFailed = lastRunEvent(events, 'agent.model.failed');
    const policy = finalPolicyEvent(events);
    const queued = lastRunEvent(events, 'agent.action.queued');
    const sent = lastRunEvent(events, 'agent.action.sent');
    const completed = lastRunEvent(events, 'agent.run.completed');
    const failed = lastRunEvent(events, 'agent.run.failed');
    const contextPayload = eventPayload(context);
    const modelPayload = eventPayload(model);
    const policyPayload = eventPayload(policy);
    const completedPayload = eventPayload(completed);
    const failedPayload = eventPayload(failed);
    const sourceIndexHints = Array.isArray(contextPayload.sourceIndexHints)
        ? contextPayload.sourceIndexHints
        : [];
    const sourceIndexToolEvents = events.filter((event) => {
        const payload = eventPayload(event);
        return (
            (event.type === 'agent.tool.requested' ||
                event.type === 'agent.tool.completed') &&
            payload.routedVia === 'source_index'
        );
    });
    const toolCompleted = events.filter(
        (event) => event.type === 'agent.tool.completed',
    );
    const toolRequested = events.filter(
        (event) => event.type === 'agent.tool.requested',
    );
    const failedTools = toolCompleted.filter(
        (event) => eventPayload(event).ok === false,
    );
    const toolNames = uniqueStrings(
        toolCompleted.map((event) => valueLabel(eventPayload(event).name)),
    );
    const actionEvent = queued ?? sent;
    const actionPayload = eventPayload(actionEvent);
    const executionResult =
        valueLabel(completedPayload.executionResult) ??
        valueLabel(failedPayload.error);

    return [
        {
            key: 'triggered',
            label: 'Triggered',
            tone: 'ok',
            at: started?.createdAt ?? run.startedAt,
            summary: `Message matched ${runTargetLabel(run)} coverage.`,
            meta: [`Thread ${run.threadTs ?? '—'}`],
        },
        {
            key: 'started',
            label: 'Started',
            tone: 'ok',
            at: run.startedAt,
            summary: 'Murph started an agent run.',
            meta: [`Task ${run.taskId.slice(0, 12)}`],
        },
        {
            key: 'memory',
            label: 'Memory recalled',
            tone:
                sourceIndexHints.length > 0 || sourceIndexToolEvents.length > 0
                    ? 'ok'
                    : 'off',
            at: context?.createdAt,
            summary:
                sourceIndexHints.length > 0 || sourceIndexToolEvents.length > 0
                    ? `Source index recalled ${sourceIndexHints.length} ${sourceIndexHints.length === 1 ? 'hint' : 'hints'} for routing.`
                    : 'No source-index hints were used for this run.',
            meta: [
                `${sourceIndexToolEvents.length} routed ${sourceIndexToolEvents.length === 1 ? 'tool event' : 'tool events'}`,
                `${valueLabel(contextPayload.artifacts) ?? '0'} ${valueLabel(contextPayload.artifacts) === '1' ? 'artifact' : 'artifacts'}`,
            ],
        },
        {
            key: 'tools',
            label: 'Tools called',
            tone: failedTools.length > 0 ? 'warn' : toolCompleted.length > 0 ? 'ok' : 'off',
            at: toolCompleted.at(-1)?.createdAt ?? toolRequested.at(-1)?.createdAt,
            summary:
                toolCompleted.length > 0
                    ? `${toolCompleted.length} ${toolCompleted.length === 1 ? 'tool completed' : 'tools completed'}${failedTools.length > 0 ? `, ${failedTools.length} failed` : ''}.`
                    : 'No external tools were called.',
            meta: [
                shortList(toolNames, 'No tool names recorded'),
                `${toolRequested.length} requested`,
            ],
        },
        {
            key: 'draft',
            label: 'Draft created',
            tone: modelFailed ? 'warn' : model ? 'ok' : 'off',
            at: model?.createdAt ?? modelFailed?.createdAt,
            summary: model
                ? `Drafted ${valueLabel(modelPayload.action) ?? 'an action'}.`
                : modelFailed
                  ? eventPayloadSummary(modelFailed.payload)
                  : 'No draft was created.',
            meta: [
                percentLabel(modelPayload.confidence)
                    ? `${percentLabel(modelPayload.confidence)} confidence`
                    : 'Confidence not recorded',
                valueLabel(modelPayload.provider) ?? 'Provider not recorded',
            ],
        },
        {
            key: 'policy',
            label: 'Policy applied',
            tone: policy ? 'ok' : 'off',
            at: policy?.createdAt,
            summary: policy
                ? `Policy ${valueLabel(policyPayload.disposition) ?? valueLabel(policyPayload.execution) ?? 'decided the outcome'}.`
                : 'No policy decision was recorded.',
            meta: [
                titleCase(valueLabel(policyPayload.execution) ?? 'No execution recorded'),
                valueLabel(policyPayload.reason) ?? 'No reason recorded',
            ],
        },
        {
            key: 'outcome',
            label: queued ? 'Queued' : sent ? 'Sent' : 'Outcome',
            tone: failed ? 'warn' : actionEvent || completed ? 'ok' : 'off',
            at: actionEvent?.createdAt ?? completed?.createdAt ?? failed?.createdAt,
            summary: queued
                ? 'Queued for operator review.'
                : sent
                  ? 'Sent automatically after policy approval.'
                  : executionResult ?? 'No outbound action was recorded.',
            meta: [
                valueLabel(actionPayload.action)
                    ? `Action: ${valueLabel(actionPayload.action)}`
                    : 'No action recorded',
                valueLabel(actionPayload.itemId)
                    ? `Item ${valueLabel(actionPayload.itemId)?.slice(0, 8)}`
                    : 'No item id',
            ],
        },
        {
            key: 'finished',
            label: 'Finished',
            tone: failed || run.status === 'failed' ? 'warn' : completed || run.completedAt ? 'ok' : 'off',
            at: completed?.createdAt ?? failed?.createdAt ?? run.completedAt,
            summary: failed
                ? valueLabel(failedPayload.error) ?? 'Run failed.'
                : completed
                  ? valueLabel(completedPayload.executionResult) ??
                    'Run completed.'
                  : 'Run is still in progress.',
            meta: [
                formatRunDuration(run.startedAt, run.completedAt),
                titleCase(run.status),
            ],
        },
    ];
}

function checkpointLogEntry(
    checkpoint: RuntimeCheckpoint,
): string {
    const meta = (checkpoint.meta ?? []).filter(Boolean);
    return `
    <li class="run-log-entry checkpoint-${escapeHtml(checkpoint.key)}">
      <div class="run-log-entry-meta">
        ${
            checkpoint.at
                ? `<time class="run-log-time" title="${escapeHtml(formatExactIso(checkpoint.at))}">${escapeHtml(formatRelative(checkpoint.at))}</time>`
                : '<span class="run-log-time">—</span>'
        }
      </div>
      <div class="run-log-event">
        <h3>
          <span
            class="run-log-step-indicator run-log-step-indicator-${escapeHtml(checkpoint.tone)}"
            aria-hidden="true"
          ></span>
          <span>${escapeHtml(checkpoint.label)}</span>
        </h3>
        <p>${escapeHtml(checkpoint.summary)}</p>
        ${
            meta.length > 0
                ? `<div class="run-log-entry-notes">${meta
                      .slice(0, 2)
                      .map((item) => `<span>${escapeHtml(item)}</span>`)
                      .join('')}</div>`
                : ''
        }
      </div>
    </li>
  `;
}

function runLogInspector(
    run: RunsPayload['runs'][number] | undefined,
    events: RunEventsPayload['events'],
): string {
    if (!run) {
        return `
      <article class="panel run-log-panel empty-run-log collapsed-run-log" id="runtime-log-panel">
        <header class="run-log-panel-title">
          <h2>Runtime log</h2>
        </header>
        <p class="empty">Select a run to inspect checkpoints.</p>
      </article>
    `;
    }
    const checkpoints = buildRuntimeCheckpoints(run, events);
    return `
    <article class="panel run-log-panel" id="runtime-log-panel">
      <header class="run-log-panel-title">
        <div>
          <h2>Runtime log</h2>
          <p>${escapeHtml(runTargetLabel(run))}</p>
        </div>
        ${consoleStateHtml(titleCase(run.status), runStatusTone(run.status))}
      </header>
      <div class="run-log-head">
        <p>Enough detail to check what happened without reading the full event transcript.</p>
        <div class="run-log-meta">
          <span><strong>Task</strong> ${escapeHtml(run.taskId.slice(0, 14))}</span>
          <span><strong>Duration</strong> ${escapeHtml(formatRunDuration(run.startedAt, run.completedAt))}</span>
        </div>
      </div>
      <section class="run-log-timeline-section" aria-label="Checkpoint timeline">
        <ol class="run-log-timeline">${checkpoints.map((checkpoint) => checkpointLogEntry(checkpoint)).join('')}</ol>
      </section>
    </article>
  `;
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

    <section class="activity-grid">
      <article class="panel activity-runs-panel">
        <header class="activity-panel-title">
          <h2>Recent runs</h2>
        </header>
        ${
            runsPayload.runs.length === 0
                ? '<p class="empty">Agent runs appear here once a Slack event triggers the gateway.</p>'
                : `<ul class="list">${runsPayload.runs.map((run) => runRow(run, selectedRun?.id, '/runs')).join('')}</ul>`
        }
      </article>

      ${runLogInspector(selectedRun, eventsPayload.events)}
    </section>
  `);
}

export async function renderActivity(): Promise<void> {
    setTitle('Murph Activity');
    loading('Activity');
    const [runsPayload, auditPayload] = await Promise.all([
        getJson<RunsPayload>('/api/gateway/runs'),
        getJson<AuditPayload>('/api/gateway/audit'),
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
        <p>Runs, tool use, policy decisions, and final outcomes from Murph's operations.</p>
      </div>
      <span class="console-state">${runsPayload.runs.length} ${runsPayload.runs.length === 1 ? 'run' : 'runs'}</span>
    </section>

    <section class="activity-grid">
      <article class="panel activity-runs-panel">
        <header class="activity-panel-title">
          <h2>Recent runs</h2>
        </header>
        ${
            runsPayload.runs.length === 0
                ? '<p class="empty">Agent runs appear here once a message triggers the gateway.</p>'
                : `<ul class="list">${runsPayload.runs.map((run) => runRow(run, selectedRun?.id, '/activity')).join('')}</ul>`
        }
      </article>

      ${runLogInspector(selectedRun, eventsPayload.events)}
    </section>

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
  `);
}
