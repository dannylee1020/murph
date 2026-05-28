import { ApiError, getJson, postJson, putJson } from '../shared/api';
import { clearDashboardToken } from '../shared/access';
import { app, themeControlHtml, getThemePreference, setThemePreference } from '../shared/shell';
import {
    escapeHtml,
    formatExactIso,
    formatRelative,
    setTitle,
    titleCase,
} from '../shared/format';
import type {
    MeBootstrapPayload,
    MeSessionsPayload,
    PolicyConfigPayload,
    QueuePayload,
    RunsPayload,
    RunEventsPayload,
    TriagePayload,
} from '../shared/types';

function meShell(content: string): void {
    const themePreference = getThemePreference();
    app.innerHTML = `
      <div class="app-shell route-me">
        <aside class="sidebar">
          <a class="brand" href="/me">
            <span class="brand-mark" aria-hidden="true"><img src="/img/murph-logo.svg" alt="" /></span>
            <span class="brand-wordmark">Murph</span>
          </a>
          <nav>
            <a href="#review">Review</a>
            <a href="#triage">Triage</a>
            <a href="#activity">Activity</a>
            <a href="#settings">Settings</a>
          </nav>
          <div class="sidebar-foot">
            ${themeControlHtml(themePreference)}
            <button type="button" class="secondary clear-me-token">Forget link</button>
          </div>
        </aside>
        <main class="content" data-route="me">${content}</main>
      </div>
    `;
    app.querySelector<HTMLButtonElement>('.clear-me-token')?.addEventListener('click', () => {
        clearDashboardToken();
        window.dispatchEvent(new PopStateEvent('popstate'));
    });
    app.querySelectorAll<HTMLButtonElement>('[data-theme-preference]').forEach((button) => {
        button.addEventListener('click', () => {
            const preference = button.dataset.themePreference as 'auto' | 'light' | 'dark' | undefined;
            if (!preference) return;
            setThemePreference(preference);
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
    });
}

function accessRequired(error?: unknown): void {
    const message = error instanceof ApiError && error.status === 401
        ? 'This dashboard link is missing, invalid, or revoked.'
        : error instanceof Error
          ? error.message
          : 'Could not load your dashboard.';
    meShell(`
      <section class="page-head">
        <p class="eyebrow">Subscriber dashboard</p>
        <h1>Access Required</h1>
        <p class="error">${escapeHtml(message)}</p>
      </section>
    `);
}

function queueHtml(queue: QueuePayload['queue']): string {
    return `
      <section class="stack" id="review">
        <div class="section-head">
          <h2>Review</h2>
          <span class="section-meta">${queue.length} queued</span>
        </div>
        ${
            queue.length === 0
                ? '<article class="panel"><p class="empty">No drafts are waiting for review.</p></article>'
                : queue.map((item) => `
                    <article class="panel draft-panel">
                      <h3>${escapeHtml(item.channelId)} <code>${escapeHtml(item.threadTs)}</code></h3>
                      <p class="draft-text">${escapeHtml(item.message || 'No message drafted')}</p>
                      <dl class="details">
                        <div><dt>Action</dt><dd>${escapeHtml(titleCase(item.action))}</dd></div>
                        <div><dt>Reason</dt><dd>${escapeHtml(item.reason)}</dd></div>
                      </dl>
                      <div class="actions">
                        <button data-me-review-id="${escapeHtml(item.id)}" data-action="approve_send">Approve and Send</button>
                        <button class="secondary" data-me-review-id="${escapeHtml(item.id)}" data-action="mark_abstain">Mark Abstain</button>
                        <button class="secondary" data-me-review-id="${escapeHtml(item.id)}" data-action="reject">Reject</button>
                      </div>
                    </article>
                  `).join('')
        }
      </section>
    `;
}

function sessionsHtml(payload: MeSessionsPayload): string {
    return `
      <section class="grid two">
        <article class="panel">
          <h2>Active Sessions</h2>
          ${
              payload.active.length === 0
                  ? '<p class="empty">No active coverage sessions.</p>'
                  : `<ul class="list">${payload.active.map((session) => `
                      <li class="list-row">
                        <strong>${escapeHtml(session.title)}</strong>
                        <span>${escapeHtml(titleCase(session.mode))} · ends ${escapeHtml(formatRelative(session.endsAt))}</span>
                        <button type="button" class="secondary" data-stop-session="${escapeHtml(session.id)}">Stop</button>
                      </li>
                    `).join('')}</ul>`
          }
          <form class="form compact-form" id="me-session-form">
            <label>
              Stop time
              <input name="stopLocalTime" value="17:00" />
            </label>
            <button type="submit">Start coverage</button>
          </form>
        </article>
        <article class="panel">
          <h2>Completed Sessions</h2>
          ${
              payload.completed.length === 0
                  ? '<p class="empty">Completed sessions will appear here.</p>'
                  : `<ul class="list">${payload.completed.slice(0, 8).map((session) => `
                      <li class="list-row">
                        <strong>${escapeHtml(session.title)}</strong>
                        <span>${escapeHtml(titleCase(session.status))} · ${escapeHtml(session.stoppedAt ? formatRelative(session.stoppedAt) : 'not stopped')}</span>
                      </li>
                    `).join('')}</ul>`
          }
        </article>
      </section>
    `;
}

function triageHtml(payload: TriagePayload): string {
    return `
      <section class="stack" id="triage">
        <div class="section-head">
          <h2>Triage</h2>
          <span class="section-meta">${payload.items.length} items</span>
        </div>
        ${
            payload.items.length === 0
                ? '<article class="panel"><p class="empty">No completed actions to triage yet.</p></article>'
                : payload.items.map((item) => `
                    <article class="panel triage-item">
                      <h3>${escapeHtml(titleCase(item.disposition ?? 'recorded'))} · ${escapeHtml(item.channelId)}</h3>
                      <dl class="details">
                        <div><dt>Recorded</dt><dd title="${escapeHtml(formatExactIso(item.createdAt))}">${escapeHtml(formatRelative(item.createdAt))}</dd></div>
                        <div><dt>Response</dt><dd>${escapeHtml(item.message || 'No message drafted')}</dd></div>
                        <div><dt>Reason</dt><dd>${escapeHtml(item.reason)}</dd></div>
                      </dl>
                    </article>
                  `).join('')
        }
      </section>
    `;
}

function activityHtml(runs: RunsPayload, events: RunEventsPayload): string {
    return `
      <section class="grid two" id="activity">
        <article class="panel">
          <h2>Runs</h2>
          ${
              runs.runs.length === 0
                  ? '<p class="empty">Runs appear here after Murph handles a message.</p>'
                  : `<ul class="list">${runs.runs.slice(0, 12).map((run) => `
                      <li class="list-row">
                        <strong>${escapeHtml(run.taskId)}</strong>
                        <span>${escapeHtml(titleCase(run.status))} · ${escapeHtml(run.channelId)} · ${escapeHtml(formatRelative(run.startedAt))}</span>
                      </li>
                    `).join('')}</ul>`
          }
        </article>
        <article class="panel">
          <h2>Latest Events</h2>
          ${
              events.events.length === 0
                  ? '<p class="empty">Select a run after activity starts to inspect events.</p>'
                  : `<ul class="list">${events.events.map((event) => `
                      <li class="list-row event-row">
                        <strong>${escapeHtml(`${event.sequence}. ${event.type}`)}</strong>
                        <pre class="event-payload">${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre>
                      </li>
                    `).join('')}</ul>`
          }
        </article>
      </section>
    `;
}

function settingsHtml(bootstrap: MeBootstrapPayload, policy: PolicyConfigPayload): string {
    const subscription = bootstrap.subscription;
    return `
      <section class="grid two" id="settings">
        <article class="panel">
          <h2>Settings</h2>
          <form class="form compact-form" id="me-subscription-form">
            <label>
              Status
              <select name="status">
                <option value="active" ${subscription.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="paused" ${subscription.status === 'paused' ? 'selected' : ''}>Paused</option>
              </select>
            </label>
            <label>
              Timezone
              <input name="timezone" value="${escapeHtml(subscription.schedule?.timezone ?? 'America/Los_Angeles')}" />
            </label>
            <button type="submit">Save settings</button>
          </form>
        </article>
        <article class="panel">
          <h2>Policy</h2>
          <form class="form compact-form" id="me-policy-form">
            <label>
              Profile
              <select name="profileName">
                ${policy.profiles.map((profile) => `
                  <option value="${escapeHtml(profile.name)}" ${profile.name === policy.selectedProfileName ? 'selected' : ''}>${escapeHtml(profile.description || profile.name)}</option>
                `).join('')}
              </select>
            </label>
            <label>
              Mode
              <select name="mode">
                <option value="manual_review" ${policy.mode === 'manual_review' ? 'selected' : ''}>Show me drafts first</option>
                <option value="auto_send_low_risk" ${policy.mode === 'auto_send_low_risk' ? 'selected' : ''}>Auto-handle routine stuff</option>
              </select>
            </label>
            <button type="submit">Save policy</button>
          </form>
        </article>
      </section>
    `;
}

export async function renderMe(): Promise<void> {
    setTitle('Murph Subscriber Dashboard');
    try {
        const bootstrap = await getJson<MeBootstrapPayload>('/api/me/bootstrap');
        const [queue, sessions, triage, runs, policy] = await Promise.all([
            getJson<QueuePayload>('/api/me/queue'),
            getJson<MeSessionsPayload>('/api/me/sessions'),
            getJson<TriagePayload>('/api/me/triage'),
            getJson<RunsPayload>('/api/me/runs'),
            getJson<PolicyConfigPayload>('/api/me/policy'),
        ]);
        const events = runs.runs[0]
            ? await getJson<RunEventsPayload>(`/api/me/runs/${runs.runs[0].id}/events`)
            : { events: [] };

        meShell(`
          <section class="page-head console-head">
            <div>
              <p class="eyebrow">Subscriber dashboard</p>
              <h1>${escapeHtml(bootstrap.subscription.displayName)}</h1>
              <p>${escapeHtml(bootstrap.workspace?.name ?? bootstrap.subscription.workspaceId)} · ${escapeHtml(titleCase(bootstrap.subscription.status))}</p>
            </div>
            <span class="console-state">${bootstrap.queuedCount} queued · ${bootstrap.activeSessionCount} active</span>
          </section>
          ${sessionsHtml(sessions)}
          ${queueHtml(queue.queue)}
          ${triageHtml(triage)}
          ${activityHtml(runs, events)}
          ${settingsHtml(bootstrap, policy)}
        `);

        app.querySelectorAll<HTMLButtonElement>('[data-me-review-id]').forEach((button) => {
            button.addEventListener('click', async () => {
                button.disabled = true;
                await postJson(`/api/me/queue/${button.dataset.meReviewId}`, {
                    action: button.dataset.action,
                });
                await renderMe();
            });
        });
        app.querySelectorAll<HTMLButtonElement>('[data-stop-session]').forEach((button) => {
            button.addEventListener('click', async () => {
                button.disabled = true;
                await postJson(`/api/me/sessions/${button.dataset.stopSession}/stop`);
                await renderMe();
            });
        });
        app.querySelector<HTMLFormElement>('#me-session-form')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget as HTMLFormElement);
            await postJson('/api/me/sessions', {
                stopLocalTime: String(form.get('stopLocalTime') ?? '17:00'),
            });
            await renderMe();
        });
        app.querySelector<HTMLFormElement>('#me-subscription-form')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget as HTMLFormElement);
            await putJson('/api/me/subscription', {
                status: String(form.get('status') ?? 'active'),
                timezone: String(form.get('timezone') ?? 'America/Los_Angeles'),
            });
            await renderMe();
        });
        app.querySelector<HTMLFormElement>('#me-policy-form')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget as HTMLFormElement);
            await putJson('/api/me/policy', {
                profileName: String(form.get('profileName') ?? ''),
                mode: String(form.get('mode') ?? 'manual_review'),
            });
            await renderMe();
        });
    } catch (error) {
        accessRequired(error);
    }
}
