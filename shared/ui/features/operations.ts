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
    renderContextRetrievalDisclosure,
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

function dispositionPill(disposition: string | undefined): string {
    if (disposition === 'auto_sent')
        return '<span class="pill pill-ok">Auto-sent</span>';
    if (disposition === 'abstained')
        return '<span class="pill pill-muted">Abstained</span>';
    return `<span class="pill pill-muted">${escapeHtml(titleCase(disposition ?? 'unknown'))}</span>`;
}

function renderReviewLifecycle(item: TriagePayload['items'][number]): string {
    const lifecycle = item.lifecycle ?? [];
    if (lifecycle.length === 0) {
        return '';
    }

    return `
        <div>
          <dt>Lifecycle</dt>
          <dd>
            <ol class="review-lifecycle">
              ${lifecycle
                  .map(
                      (entry) => `
                <li>
                  <span>${escapeHtml(entry.label)}</span>
                  <time title="${escapeHtml(formatExactIso(entry.createdAt))}">${escapeHtml(formatRelative(entry.createdAt))}</time>
                  <small>${escapeHtml(entry.reason || titleCase(entry.disposition))}</small>
                </li>
              `,
                  )
                  .join('')}
            </ol>
          </dd>
        </div>
    `;
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
        ${renderReviewLifecycle(item)}
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

export async function renderTriage(): Promise<void> {
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
                          const channelLabel = channelDisplayLabel(run);
                          const channelTitle = channelDisplayTitle(run);
                          return `
                    <li>
                      <a
                        class="list-row run-item ${isActive ? 'active' : ''}"
                        data-link
                        href="/runs?id=${escapeHtml(run.id)}"
                        ${isActive ? 'aria-current="true"' : ''}
                      >
                        <strong>${escapeHtml(run.taskId)}</strong>
                        <span title="${escapeHtml(channelTitle)}">${escapeHtml(titleCase(run.status))} · ${escapeHtml(channelLabel)}</span>
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

export async function renderActivity(): Promise<void> {
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
              <dl class="details">
                <div><dt>Channel</dt><dd title="${escapeHtml(channelDisplayTitle(selectedRun))}">${escapeHtml(channelDisplayLabel(selectedRun))}</dd></div>
                <div><dt>Thread</dt><dd><code>${escapeHtml(selectedRun.threadTs)}</code></dd></div>
              </dl>
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

    ${selectedRun ? renderContextRetrievalDisclosure(eventsPayload.events) : ''}
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
