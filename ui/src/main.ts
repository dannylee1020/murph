import './styles.css';

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
    policyConfigured?: boolean;
    policy?: {
      profileName?: string;
      overrideRaw?: string;
      raw: string;
      compiled: {
        blockedTopics: string[];
        alwaysQueueTopics: string[];
        blockedActions: string[];
        requireGroundingForFacts: boolean;
        preferAskWhenUncertain: boolean;
        allowAutoSend: boolean;
        notesForAgent: string[];
      };
      compiledAt: string;
      source: string;
      version: number;
    } | null;
  }>;
  sessions: Array<{
    id: string;
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
  channels: Array<{ id: string; displayName: string; capabilities: string[] }>;
  contextSources: Array<{ name: string; description: string; optional: boolean; source: string }>;
  tools: Array<{ name: string; description: string; sideEffectClass: string; optional: boolean; source: string }>;
  plugins: Array<{ id: string; name: string; description: string; version?: string }>;
  skills: Array<{ name: string; description: string; riskLevel: string; toolNames: string[]; contextSourceNames?: string[] }>;
  enabledOptionalTools: string[];
  enabledContextSources: string[];
  enabledPlugins: string[];
  defaultPolicyProfileName?: string;
};

type SetupStatusPayload = {
  slack: { installed: boolean; oauthConfigured: boolean; signingSecretConfigured: boolean };
  discord: { installed: boolean; oauthConfigured: boolean; botTokenConfigured: boolean };
  provider: { configured: boolean; defaultProvider: string };
  notion: {
    configured: boolean;
    pageAllowlistCount: number;
    dataSourceAllowlistCount: number;
    version: string;
  };
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
  autoJoined?: ChannelActionItem[];
  error?: string;
  requiresInvitation?: ChannelActionItem[];
  reinstallRequired?: boolean;
  errors?: ChannelActionItem[];
};

type PolicyPreviewPayload = {
  ok: boolean;
  selectedProfileName: string;
  compiled: {
    blockedTopics: string[];
    alwaysQueueTopics: string[];
    blockedActions: string[];
    requireGroundingForFacts: boolean;
    preferAskWhenUncertain: boolean;
    allowAutoSend: boolean;
    notesForAgent: string[];
  };
  warnings: string[];
};

type PolicyProfilesPayload = {
  profiles: Array<{
    name: string;
    description: string;
    compiled: PolicyPreviewPayload['compiled'];
    source: string;
  }>;
};

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('App root not found');
}

const app = root;
let dashboardNotice = '';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/review', label: 'Review' },
  { href: '/runs', label: 'Runs' },
  { href: '/audit', label: 'Decisions' },
  { href: '/settings', label: 'Settings' }
];

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Request failed: ${path}`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(payload.error ?? `Request failed: ${path}`, response.status, payload);
  }
  return payload;
}

class ApiError<TPayload = unknown> extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: TPayload
  ) {
    super(message);
  }
}

async function putJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PUT',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed: ${path}`);
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
    month: 'short'
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
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}

function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
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
    timeZoneName: 'short'
  }).format(date);
}

function titleCase(value: string): string {
  return value
    .replace(/[_.]/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function sessionModeLabel(mode: string): string {
  if (mode === 'manual_review') return 'Manual review';
  if (mode === 'dry_run') return 'Dry run';
  if (mode === 'auto_send_low_risk') return 'Low-risk auto-send';
  return titleCase(mode);
}

function policyAssignmentLabel(user: SummaryPayload['users'][number]): string {
  if (user.policy?.profileName) {
    return user.policy.profileName;
  }
  if (user.policyConfigured) {
    return 'Custom override';
  }
  return 'Built-in or workspace default';
}

function shell(content: string): void {
  const pathname = window.location.pathname;
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="/" data-link>
          <span class="brand-mark">Murph</span>
          <span class="brand-text">
            <strong>Timezone</strong>
            <small>Autopilot</small>
          </span>
        </a>
        <nav>
          ${navItems
            .map(
              (item) => `
                <a href="${item.href}" data-link class="${pathname === item.href ? 'active' : ''}">
                  ${item.label}
                </a>
              `
            )
            .join('')}
        </nav>
      </aside>
      <main class="content">${content}</main>
    </div>
  `;

  app.querySelectorAll<HTMLAnchorElement>('a[data-link]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      history.pushState(null, '', link.href);
      void render();
    });
  });
}

function loading(title: string): void {
  shell(`<section class="page-head"><p class="eyebrow">Murph</p><h1>${title}</h1><p>Loading...</p></section>`);
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

function sessionCreateErrorHtml(payload: SessionCreateResponse): string {
  if (payload.error !== 'channels_require_action') {
    return `<div class="notice danger">${escapeHtml(payload.error ?? 'Session could not be started.')}</div>`;
  }

  const inviteRows = (payload.requiresInvitation ?? [])
    .map(
      (item) => `
        <div class="action-row">
          <span>${escapeHtml(channelName(item))}</span>
          <code>${escapeHtml(item.action ?? '')}</code>
          <button type="button" class="secondary copy-action" data-copy="${escapeHtml(item.action ?? '')}">Copy</button>
        </div>
      `
    )
    .join('');
  const errorRows = (payload.errors ?? [])
    .map(
      (item) => `
        <div class="action-row">
          <span>${escapeHtml(channelName(item))}</span>
          <code>${escapeHtml(item.reason ?? 'Channel membership check failed')}</code>
        </div>
      `
    )
    .join('');

  return `
    <div class="notice danger">
      <strong>Channel access required</strong>
      ${
        payload.reinstallRequired
          ? '<p>The Slack app needs the latest channel scopes before this session can start.</p><a class="button" href="/api/slack/install">Reinstall Slack app</a>'
          : ''
      }
      ${inviteRows ? `<div class="action-list">${inviteRows}</div>` : ''}
      ${errorRows ? `<div class="action-list">${errorRows}</div>` : ''}
    </div>
  `;
}

function metric(label: string, value: string | number): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function list(items: string[], emptyText: string): string {
  if (items.length === 0) {
    return `<p class="empty">${escapeHtml(emptyText)}</p>`;
  }
  return `<ul class="list">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function policyPreviewHtml(payload: PolicyPreviewPayload): string {
  const warnings = payload.warnings.map((warning) => `<p class="empty">${escapeHtml(warning)}</p>`).join('');
  const compiled = payload.compiled;

  return `
    ${warnings}
    <dl class="details">
      <div><dt>Base profile</dt><dd>${escapeHtml(payload.selectedProfileName)}</dd></div>
      <div><dt>Blocked topics</dt><dd>${escapeHtml(compiled.blockedTopics.join(', ') || 'None')}</dd></div>
      <div><dt>Queue for review</dt><dd>${escapeHtml(compiled.alwaysQueueTopics.join(', ') || 'None')}</dd></div>
      <div><dt>Blocked actions</dt><dd>${escapeHtml(compiled.blockedActions.join(', ') || 'None')}</dd></div>
      <div><dt>Require grounding</dt><dd>${compiled.requireGroundingForFacts ? 'Yes' : 'No'}</dd></div>
      <div><dt>Prefer clarification</dt><dd>${compiled.preferAskWhenUncertain ? 'Yes' : 'No'}</dd></div>
      <div><dt>Allow low-risk auto-send</dt><dd>${compiled.allowAutoSend ? 'Yes' : 'No'}</dd></div>
      <div><dt>Notes</dt><dd>${escapeHtml(compiled.notesForAgent.join(', ') || 'None')}</dd></div>
    </dl>
  `;
}

async function renderDashboard(): Promise<void> {
  setTitle('Murph');
  loading('Dashboard');
  const [data, recurring, policyProfilesPayload] = await Promise.all([
    getJson<SummaryPayload>('/api/gateway/summary'),
    getJson<RecurringJobsPayload>('/api/gateway/recurring-jobs'),
    getJson<PolicyProfilesPayload>('/api/gateway/policy-profiles')
  ]);

  shell(`
    <section class="page-head">
      <p class="eyebrow">${escapeHtml(formatToday())} · ${escapeHtml(formatSessionStatus(data.summary.activeSessionCount))}</p>
      <h1>Dashboard</h1>
    </section>

    <dl class="kpis">
      ${metric('Workspace', data.summary.workspace?.name ?? 'Not installed')}
      ${metric('Provider', data.summary.provider ? `${data.summary.provider.provider} / ${data.summary.provider.model}` : 'Not configured')}
      ${metric('Active sessions', data.summary.activeSessionCount)}
      ${metric('Queued actions', data.summary.queuedCount)}
    </dl>
    ${sessionFeedbackHtml()}

    <section class="grid two">
      <article class="panel">
        <h2>Start Session</h2>
        ${
          data.summary.workspace
            ? `
              <form id="start-session-form" class="form">
                <label><span>Owner User ID</span><input name="ownerUserId" placeholder="U123ABC" required /></label>
                <label><span>Title</span><input name="title" value="Overnight autopilot" /></label>
                <label>
                  <span>Mode</span>
                  <select name="mode">
                    <option value="manual_review">Manual review</option>
                    <option value="dry_run">Dry run</option>
                    <option value="auto_send_low_risk">Low-risk auto-send</option>
                  </select>
                </label>
                <label><span>Channel Scope</span><input name="channelScope" placeholder="C123ABC,C987XYZ" /></label>
                <label><span>Duration Hours</span><input name="durationHours" type="number" min="1" value="10" /></label>
                <label>
                  <span>Policy Profile</span>
                  <select name="policyProfileName">
                    <option value="">Built-in default</option>
                    ${policyProfilesPayload.profiles
                      .map((profile) => `<option value="${escapeHtml(profile.name)}">${escapeHtml(profile.name)} — ${escapeHtml(profile.description)}</option>`)
                      .join('')}
                  </select>
                </label>
                <label>
                  <span>Policy Override</span>
                  <textarea name="policyOverrideRaw" rows="5" placeholder="Optional override using supported policy fields."></textarea>
                </label>
                <div id="start-session-policy-preview" class="policy-preview"></div>
                <div id="start-session-feedback"></div>
                <button type="submit">Start Session</button>
              </form>
            `
            : `<p>Install a channel app first.</p>${data.summary.installUrl ? `<a class="button" href="${escapeHtml(data.summary.installUrl)}">Install Channel App</a>` : ''}`
        }
      </article>

      <article class="panel">
        <h2>Active Sessions</h2>
        ${list(
          data.sessions.map(
            (session) => `
              <div class="list-row">
                <strong>${escapeHtml(session.title)}</strong>
                <span>${escapeHtml(session.ownerUserId)} · ${escapeHtml(sessionModeLabel(session.mode))}</span>
                <span title="${escapeHtml(formatExactIso(session.endsAt))}">Ends ${escapeHtml(formatDateTime(session.endsAt))}</span>
                <span>${escapeHtml(session.channelScope.length > 0 ? session.channelScope.join(', ') : 'All channels in scope')}</span>
                <button class="secondary stop-session" data-session-id="${escapeHtml(session.id)}">Stop</button>
              </div>
            `
          ),
          'Start a session before logging off and Murph will watch your scoped channels.'
        )}
      </article>
    </section>

    <section class="grid two">
      <article class="panel">
        <h2>Schedule Morning Digest</h2>
        ${
          data.sessions.length > 0
            ? `
              <form id="schedule-digest-form" class="form">
                <label>
                  <span>Session</span>
                  <select name="sessionId">
                    ${data.sessions.map((session) => `<option value="${escapeHtml(session.id)}">${escapeHtml(session.title)}</option>`).join('')}
                  </select>
                </label>
                <label><span>Channel ID</span><input name="channelId" placeholder="C123ABC" required /></label>
                <label><span>Owner User ID</span><input name="ownerUserId" value="${escapeHtml(data.sessions[0]?.ownerUserId ?? '')}" required /></label>
                <label><span>Local Time</span><input name="localTime" type="time" value="08:30" required /></label>
                <label><span>Timezone</span><input name="timezone" value="America/Los_Angeles" required /></label>
                <button type="submit">Schedule Digest</button>
              </form>
            `
            : '<p>Start a session before scheduling a morning digest.</p>'
        }
      </article>

      <article class="panel">
        <h2>Morning Digest Jobs</h2>
        ${list(
          recurring.jobs.map(
            (job) => `
              <div class="list-row">
                <strong>${escapeHtml(job.payload.channelId)} at ${escapeHtml(job.localTime)}</strong>
                <span>${escapeHtml(job.timezone)} · ${escapeHtml(titleCase(job.status))}</span>
                <span title="${escapeHtml(formatExactIso(job.nextRunAt))}">Next ${escapeHtml(formatRelative(job.nextRunAt))}</span>
                <button class="secondary delete-recurring-job" data-job-id="${escapeHtml(job.id)}">Delete</button>
              </div>
            `
          ),
          'Schedule a digest to get a morning summary in a chosen channel.'
        )}
      </article>
    </section>

    <section class="grid two">
      <article class="panel">
        <h2>Latest Briefing</h2>
        ${
          data.summary.latestBriefing
            ? `<p><strong>${escapeHtml(data.summary.latestBriefing.session.title)}</strong></p>
               <p>${data.summary.latestBriefing.handledCount} handled, ${data.summary.latestBriefing.queuedCount} queued, ${data.summary.latestBriefing.abstainedCount} abstained, ${data.summary.latestBriefing.failedCount} failed</p>`
            : '<p>No completed session briefing yet.</p>'
        }
      </article>

      <article class="panel">
        <h2>Recent Traces</h2>
        ${list(
          data.traces.map(
            (trace) => `
              <div class="list-row">
                <strong>${escapeHtml(trace.run.taskId)}</strong>
                <span>${escapeHtml(trace.executionResult)}</span>
                <span title="${escapeHtml(formatExactIso(trace.createdAt))}">${escapeHtml(formatRelative(trace.createdAt))}</span>
              </div>
            `
          ),
          'Decision traces appear here once the agent handles Slack threads.'
        )}
      </article>
    </section>
  `);

  const startSessionForm = app.querySelector<HTMLFormElement>('#start-session-form');
  const startOwnerInput = startSessionForm?.querySelector<HTMLInputElement>('input[name="ownerUserId"]');
  const startModeInput = startSessionForm?.querySelector<HTMLSelectElement>('select[name="mode"]');
  const startProfileInput = startSessionForm?.querySelector<HTMLSelectElement>('select[name="policyProfileName"]');
  const startPolicyInput = startSessionForm?.querySelector<HTMLTextAreaElement>('textarea[name="policyOverrideRaw"]');
  const startPolicyPreview = startSessionForm?.querySelector<HTMLDivElement>('#start-session-policy-preview');
  const knownUsers = new Map(data.users.map((user) => [user.externalUserId.toLowerCase(), user]));

  const refreshStartSessionPolicy = async (options: { hydrateKnownUser?: boolean } = {}): Promise<void> => {
    if (!startModeInput || !startPolicyInput || !startPolicyPreview || !startProfileInput) {
      return;
    }

    const knownUser = startOwnerInput ? knownUsers.get(startOwnerInput.value.trim().toLowerCase()) : undefined;
    if (options.hydrateKnownUser) {
      startProfileInput.value = knownUser?.policy?.profileName ?? '';
      startPolicyInput.value = knownUser?.policy?.overrideRaw ?? '';
    }

    const preview = await postJson<PolicyPreviewPayload>('/api/gateway/policy/preview', {
      profileName: startProfileInput.value || undefined,
      userProfileName: knownUser?.policy?.profileName,
      overrideRaw: startPolicyInput.value,
      sessionMode: startModeInput.value
    });
    startPolicyPreview.innerHTML = policyPreviewHtml(preview);
  };

  if (startSessionForm && startPolicyInput) {
    void refreshStartSessionPolicy({ hydrateKnownUser: true });
    startOwnerInput?.addEventListener('change', () => {
      void refreshStartSessionPolicy({ hydrateKnownUser: true });
    });
    startModeInput?.addEventListener('change', () => {
      const knownUser = startOwnerInput ? knownUsers.get(startOwnerInput.value.trim().toLowerCase()) : undefined;
      if (!knownUser?.policy && startProfileInput) {
        startProfileInput.value = '';
        startPolicyInput.value = '';
      }
      void refreshStartSessionPolicy();
    });
    startProfileInput?.addEventListener('change', () => {
      void refreshStartSessionPolicy();
    });
    startPolicyInput.addEventListener('input', () => {
      void refreshStartSessionPolicy();
    });
  }

  startSessionForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const feedback = form.querySelector<HTMLDivElement>('#start-session-feedback');

    try {
      const result = await postJson<SessionCreateResponse>('/api/gateway/sessions', {
        ownerUserId: String(formData.get('ownerUserId') ?? ''),
        title: String(formData.get('title') ?? ''),
        mode: String(formData.get('mode') ?? 'manual_review'),
        channelScope: String(formData.get('channelScope') ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        durationHours: Number(formData.get('durationHours') ?? 10),
        policyProfileName: String(formData.get('policyProfileName') ?? ''),
        policyOverrideRaw: String(formData.get('policyOverrideRaw') ?? '')
      });
      const joined = result.autoJoined ?? [];
      dashboardNotice =
        joined.length > 0
          ? `Started session and joined ${joined.map(channelName).join(', ')}.`
          : 'Started session.';
      await renderDashboard();
    } catch (error) {
      if (error instanceof ApiError) {
        feedback!.innerHTML = sessionCreateErrorHtml(error.payload as SessionCreateResponse);
        feedback!.querySelectorAll<HTMLButtonElement>('.copy-action').forEach((button) => {
          button.addEventListener('click', async () => {
            await navigator.clipboard.writeText(button.dataset.copy ?? '');
            button.textContent = 'Copied';
          });
        });
        return;
      }
      throw error;
    }
  });

  app.querySelectorAll<HTMLButtonElement>('.stop-session').forEach((button) => {
    button.addEventListener('click', async () => {
      await postJson(`/api/gateway/sessions/${button.dataset.sessionId}/stop`);
      await renderDashboard();
    });
  });

  app.querySelector<HTMLFormElement>('#schedule-digest-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    await postJson('/api/gateway/recurring-jobs', {
      sessionId: String(formData.get('sessionId') ?? ''),
      channelId: String(formData.get('channelId') ?? ''),
      ownerUserId: String(formData.get('ownerUserId') ?? ''),
      localTime: String(formData.get('localTime') ?? '08:30'),
      timezone: String(formData.get('timezone') ?? 'America/Los_Angeles')
    });
    await renderDashboard();
  });

  app.querySelectorAll<HTMLButtonElement>('.delete-recurring-job').forEach((button) => {
    button.addEventListener('click', async () => {
      await fetch(`/api/gateway/recurring-jobs/${button.dataset.jobId}`, { method: 'DELETE' });
      await renderDashboard();
    });
  });
}

async function renderSettings(): Promise<void> {
  setTitle('Murph Settings');
  loading('Settings');
  const [summary, runtime, setup, policyProfilesPayload] = await Promise.all([
    getJson<SummaryPayload>('/api/gateway/summary'),
    getJson<RuntimePayload>('/api/gateway/runtime'),
    getJson<SetupStatusPayload>('/api/setup/status'),
    getJson<PolicyProfilesPayload>('/api/gateway/policy-profiles')
  ]);
  const toggleRows = [
    ...runtime.tools
      .filter((tool) => tool.optional)
      .map((tool) => ({ kind: 'tool', name: tool.name, description: tool.description, enabled: runtime.enabledOptionalTools.includes(tool.name) })),
    ...runtime.contextSources
      .filter((source) => source.optional)
      .map((source) => ({
        kind: 'context',
        name: source.name,
        description: source.description,
        enabled: runtime.enabledContextSources.includes(source.name)
      }))
  ];

  shell(`
    <section class="page-head">
      <p class="eyebrow">Runtime</p>
      <h1>Settings</h1>
      <p>Workspace install state, users, and loaded runtime capabilities.</p>
    </section>

    <dl class="kpis">
      ${metric('Workspace', summary.summary.workspace?.name ?? 'Not installed')}
      ${metric('Provider', summary.summary.provider ? `${summary.summary.provider.provider} / ${summary.summary.provider.model}` : 'Not configured')}
      ${metric('Channels', runtime.channels.length)}
      ${metric('Tools', runtime.tools.length)}
    </dl>

    <section class="grid three">
      <article class="panel panel-status">
        <h2><span class="status-dot ${setup.slack.installed && setup.slack.oauthConfigured ? 'ok' : 'off'}" aria-hidden="true"></span>Slack</h2>
        <dl class="details">
          <div><dt>Install</dt><dd>${setup.slack.installed ? 'Installed' : 'Not installed'}</dd></div>
          <div><dt>OAuth</dt><dd>${setup.slack.oauthConfigured ? 'Configured' : 'Missing'}</dd></div>
          <div><dt>Signing secret</dt><dd>${setup.slack.signingSecretConfigured ? 'Configured' : 'Missing'}</dd></div>
        </dl>
      </article>
      <article class="panel panel-status">
        <h2><span class="status-dot ${setup.discord.installed && setup.discord.oauthConfigured && setup.discord.botTokenConfigured ? 'ok' : 'off'}" aria-hidden="true"></span>Discord</h2>
        <dl class="details">
          <div><dt>Install</dt><dd>${setup.discord.installed ? 'Installed' : 'Not installed'}</dd></div>
          <div><dt>OAuth</dt><dd>${setup.discord.oauthConfigured ? 'Configured' : 'Missing'}</dd></div>
          <div><dt>Bot token</dt><dd>${setup.discord.botTokenConfigured ? 'Configured' : 'Missing'}</dd></div>
        </dl>
      </article>
      <article class="panel panel-status">
        <h2><span class="status-dot ${setup.provider.configured ? 'ok' : 'off'}" aria-hidden="true"></span>Provider</h2>
        <dl class="details">
          <div><dt>Status</dt><dd>${setup.provider.configured ? 'Configured' : 'Missing API key'}</dd></div>
          <div><dt>Default</dt><dd>${escapeHtml(setup.provider.defaultProvider)}</dd></div>
        </dl>
      </article>
      <article class="panel panel-status">
        <h2><span class="status-dot ${setup.notion.configured ? 'ok' : 'off'}" aria-hidden="true"></span>Notion</h2>
        <dl class="details">
          <div><dt>Status</dt><dd>${setup.notion.configured ? 'Configured' : 'Missing token'}</dd></div>
          <div><dt>API version</dt><dd>${escapeHtml(setup.notion.version)}</dd></div>
          <div><dt>Allowed roots</dt><dd>${setup.notion.pageAllowlistCount + setup.notion.dataSourceAllowlistCount}</dd></div>
        </dl>
      </article>
    </section>

    <section class="panel">
      <h2>Channel Installs</h2>
      ${
        [
          setup.slack.oauthConfigured
            ? `<a class="button" href="/api/slack/install">${setup.slack.installed ? 'Reinstall Slack app' : 'Install Slack app'}</a>`
            : '<p>Slack OAuth is not configured.</p>',
          setup.discord.oauthConfigured && setup.discord.botTokenConfigured
            ? `<a class="button" href="/api/discord/install">${setup.discord.installed ? 'Reinstall Discord app' : 'Install Discord app'}</a>`
            : '<p>Discord OAuth or bot token is not configured.</p>'
        ].join('')
      }
    </section>

    <section class="grid two">
      <article class="panel wide">
        <h2>Capabilities</h2>
        ${list(
          toggleRows.map(
            (item) => `
              <label class="toggle-row">
                <input type="checkbox" data-capability-kind="${escapeHtml(item.kind)}" data-capability-name="${escapeHtml(item.name)}" ${item.enabled ? 'checked' : ''} />
                <span>
                  <strong>${escapeHtml(item.name)}</strong>
                  <small>${escapeHtml(item.description)}</small>
                </span>
              </label>
            `
          ),
          'No optional capabilities registered.'
        )}
      </article>

      <article class="panel">
        <h2>Policy Profiles</h2>
        <p class="empty">Profiles define reusable review and send rules. Assignment happens per workspace, user, or session.</p>
        ${list(
          policyProfilesPayload.profiles.map(
            (profile) => `
              <div class="list-row">
                <strong>${escapeHtml(profile.name)}</strong>
                <span>${escapeHtml(profile.description)}</span>
                <span>${escapeHtml(profile.source)}</span>
              </div>
            `
          ),
          'No filesystem policy profiles were loaded.'
        )}
        <form id="workspace-policy-form" class="form">
          <label>
            <span>Workspace Default</span>
            <select name="defaultPolicyProfileName">
              <option value="">Built-in default</option>
              ${policyProfilesPayload.profiles
                .map((profile) => `<option value="${escapeHtml(profile.name)}" ${runtime.defaultPolicyProfileName === profile.name ? 'selected' : ''}>${escapeHtml(profile.name)}</option>`)
                .join('')}
            </select>
          </label>
          <button type="submit">Save Workspace Default</button>
        </form>
      </article>

      <article class="panel">
        <h2>Users</h2>
        ${
          summary.users.length === 0
            ? '<p class="empty">No users have been learned yet.</p>'
            : `
              <div class="list">
                ${summary.users
                  .map(
                    (user) => `
                      <div class="list-row">
                        <strong>${escapeHtml(user.displayName)}</strong>
                        <span>${escapeHtml(user.externalUserId)}</span>
                        <span>${escapeHtml(policyAssignmentLabel(user))}</span>
                      </div>
                    `
                  )
                  .join('')}
              </div>
              <form id="user-policy-form" class="form">
                <label>
                  <span>User</span>
                  <select name="userId">
                    ${summary.users
                      .map((user) => `<option value="${escapeHtml(user.externalUserId)}">${escapeHtml(`${user.displayName} (${user.externalUserId})`)}</option>`)
                      .join('')}
                  </select>
                </label>
                <label>
                  <span>Session Mode</span>
                  <select name="sessionMode">
                    <option value="manual_review">Manual review</option>
                    <option value="dry_run">Dry run</option>
                    <option value="auto_send_low_risk">Low-risk auto-send</option>
                  </select>
                </label>
                <label>
                  <span>Policy Profile</span>
                  <select name="profileName">
                    <option value="">Built-in default</option>
                    ${policyProfilesPayload.profiles
                      .map((profile) => `<option value="${escapeHtml(profile.name)}">${escapeHtml(profile.name)}</option>`)
                      .join('')}
                  </select>
                </label>
                <label>
                  <span>Policy Override</span>
                  <textarea name="overrideRaw" rows="5"></textarea>
                </label>
                <div id="user-policy-preview" class="policy-preview"></div>
                <button type="submit">Save User Policy</button>
              </form>
            `
        }
      </article>

      <article class="panel">
        <h2>Channels</h2>
        ${list(
          runtime.channels.map(
            (channel) => `
              <div class="list-row">
                <strong>${escapeHtml(channel.displayName)}</strong>
                <span>${escapeHtml(channel.id)}</span>
                <span class="pills">${channel.capabilities
                  .map((cap) => `<span class="pill pill-muted">${escapeHtml(cap)}</span>`)
                  .join('')}</span>
              </div>
            `
          ),
          'Add a channel adapter to let Murph watch a new messenger.'
        )}
      </article>

      <article class="panel">
        <h2>Context Sources</h2>
        ${list(
          runtime.contextSources.map(
            (source) => `
              <div class="list-row">
                <strong>${escapeHtml(source.name)}</strong>
                <span>${escapeHtml(source.description)}</span>
                <span class="pills">
                  <span class="pill ${source.optional ? 'pill-muted' : ''}">${source.optional ? 'Optional' : 'Core'}</span>
                  <span class="pill pill-muted">${escapeHtml(source.source)}</span>
                </span>
              </div>
            `
          ),
          'Context sources ground the agent in external documents and memory.'
        )}
      </article>

      <article class="panel">
        <h2>Tools</h2>
        ${list(
          runtime.tools.map(
            (tool) => `
              <div class="list-row">
                <strong>${escapeHtml(tool.name)}</strong>
                <span class="pills">
                  <span class="pill">${escapeHtml(tool.sideEffectClass)}</span>
                  <span class="pill ${tool.optional ? 'pill-muted' : ''}">${tool.optional ? 'Optional' : 'Core'}</span>
                  <span class="pill pill-muted">${escapeHtml(tool.source)}</span>
                </span>
              </div>
            `
          ),
          'Tools are the agent\u2019s policy-gated action surface.'
        )}
      </article>

      <article class="panel wide">
        <h2>Skills</h2>
        ${list(
          runtime.skills.map(
            (skill) => `
              <div class="list-row">
                <strong>${escapeHtml(skill.name)}</strong>
                <span>${escapeHtml(skill.contextSourceNames?.length ? `Context: ${skill.contextSourceNames.join(', ')}` : 'No context sources')}</span>
                <span class="pills">
                  <span class="pill ${skill.riskLevel === 'high' ? 'pill-warn' : skill.riskLevel === 'medium' ? 'pill-muted' : ''}">${escapeHtml(titleCase(skill.riskLevel))} risk</span>
                </span>
              </div>
            `
          ),
          'Skills define trigger phrases and tool needs; add a SKILL.md to /skills to register one.'
        )}
      </article>
    </section>
  `);

  app.querySelectorAll<HTMLInputElement>('[data-capability-name]').forEach((input) => {
    input.addEventListener('change', async () => {
      const toolInputs = Array.from(app.querySelectorAll<HTMLInputElement>('[data-capability-kind="tool"]'));
      const contextInputs = Array.from(app.querySelectorAll<HTMLInputElement>('[data-capability-kind="context"]'));
      await putJson('/api/gateway/workspace-memory', {
        enabledOptionalTools: toolInputs.filter((entry) => entry.checked).map((entry) => entry.dataset.capabilityName),
        enabledContextSources: contextInputs.filter((entry) => entry.checked).map((entry) => entry.dataset.capabilityName),
        defaultPolicyProfileName: runtime.defaultPolicyProfileName
      });
      await renderSettings();
    });
  });

  app.querySelector<HTMLFormElement>('#workspace-policy-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    await putJson('/api/gateway/workspace-memory', {
      defaultPolicyProfileName: String(formData.get('defaultPolicyProfileName') ?? '')
    });
    dashboardNotice = 'Saved workspace default profile.';
    await renderSettings();
  });

  const userPolicyForm = app.querySelector<HTMLFormElement>('#user-policy-form');
  if (userPolicyForm) {
    const userSelect = userPolicyForm.querySelector<HTMLSelectElement>('select[name="userId"]');
    const modeSelect = userPolicyForm.querySelector<HTMLSelectElement>('select[name="sessionMode"]');
    const profileSelect = userPolicyForm.querySelector<HTMLSelectElement>('select[name="profileName"]');
    const policyInput = userPolicyForm.querySelector<HTMLTextAreaElement>('textarea[name="overrideRaw"]');
    const preview = userPolicyForm.querySelector<HTMLDivElement>('#user-policy-preview');
    const usersById = new Map(summary.users.map((user) => [user.externalUserId, user]));

    const refreshUserPolicyPreview = async (): Promise<void> => {
      if (!modeSelect || !policyInput || !preview || !profileSelect) {
        return;
      }
      const user = userSelect ? usersById.get(userSelect.value) : undefined;
      const payload = await postJson<PolicyPreviewPayload>('/api/gateway/policy/preview', {
        profileName: profileSelect.value || undefined,
        userProfileName: user?.policy?.profileName,
        overrideRaw: policyInput.value,
        sessionMode: modeSelect.value
      });
      preview.innerHTML = policyPreviewHtml(payload);
    };

    const hydrateUserPolicy = async (): Promise<void> => {
      if (!userSelect || !policyInput || !profileSelect) {
        return;
      }
      const policy = usersById.get(userSelect.value)?.policy;
      profileSelect.value = policy?.profileName ?? '';
      policyInput.value = policy?.overrideRaw ?? '';
      await refreshUserPolicyPreview();
    };

    void hydrateUserPolicy();
    userSelect?.addEventListener('change', () => {
      void hydrateUserPolicy();
    });
    modeSelect?.addEventListener('change', () => {
      const user = userSelect ? usersById.get(userSelect.value) : undefined;
      if (!user?.policy) {
        profileSelect!.value = '';
        policyInput!.value = '';
      }
      void refreshUserPolicyPreview();
    });
    profileSelect?.addEventListener('change', () => {
      void refreshUserPolicyPreview();
    });
    policyInput?.addEventListener('input', () => {
      void refreshUserPolicyPreview();
    });
    userPolicyForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!userSelect || !modeSelect || !policyInput || !profileSelect) {
        return;
      }
      await putJson(`/api/gateway/users/${encodeURIComponent(userSelect.value)}/policy`, {
        profileName: profileSelect.value,
        overrideRaw: policyInput.value,
        sessionMode: modeSelect.value
      });
      dashboardNotice = 'Saved user policy settings.';
      await renderSettings();
    });
  }
}

async function renderReview(): Promise<void> {
  setTitle('Murph Review Queue');
  loading('Review Queue');
  const [queuePayload, sessionsPayload] = await Promise.all([
    getJson<QueuePayload>('/api/gateway/queue'),
    getJson<SessionsPayload>('/api/gateway/sessions')
  ]);

  shell(`
    <section class="page-head">
      <p class="eyebrow">Manual review</p>
      <h1>Review Queue</h1>
      <p>${escapeHtml(
        sessionsPayload.sessions.length > 0
          ? `Active sessions: ${sessionsPayload.sessions.map((session) => `${session.title} (${sessionModeLabel(session.mode)})`).join(', ')}`
          : 'No active sessions.'
      )}</p>
    </section>

    <section class="stack">
      ${
        queuePayload.queue.length === 0
          ? '<article class="panel"><p class="empty">Queued drafts appear here whenever Murph proposes a reply under manual review. Nothing waiting right now.</p></article>'
          : queuePayload.queue
              .map(
                (item) => `
                  <article class="panel">
                    <h2>${escapeHtml(item.channelId)} / ${escapeHtml(item.threadTs)}</h2>
                    <dl class="details">
                      <div><dt>Session</dt><dd>${escapeHtml(item.sessionId ?? '—')}</dd></div>
                      <div><dt>Owner</dt><dd>${escapeHtml(item.targetUserId ?? 'Unknown')}</dd></div>
                      <div><dt>Action</dt><dd>${escapeHtml(titleCase(item.action))}</dd></div>
                      <div><dt>Reason</dt><dd>${escapeHtml(item.reason)}</dd></div>
                      <div><dt>Draft</dt><dd>${escapeHtml(item.message || 'No message drafted')}</dd></div>
                    </dl>
                    <div class="actions">
                      <button data-review-id="${escapeHtml(item.id)}" data-action="approve_send">Approve and Send</button>
                      <button class="secondary" data-review-id="${escapeHtml(item.id)}" data-action="mark_abstain">Mark Abstain</button>
                      <button class="secondary" data-review-id="${escapeHtml(item.id)}" data-action="reject">Reject</button>
                    </div>
                  </article>
                `
              )
              .join('')
      }
    </section>
  `);

  app.querySelectorAll<HTMLButtonElement>('[data-review-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      await postJson(`/api/gateway/queue/${button.dataset.reviewId}`, {
        action: button.dataset.action
      });
      await renderReview();
    });
  });
}

async function renderAudit(): Promise<void> {
  setTitle('Murph Decisions');
  loading('Decision Log');
  const [auditPayload, tracePayload] = await Promise.all([
    getJson<AuditPayload>('/api/gateway/audit'),
    getJson<TracesPayload>('/api/gateway/traces')
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
                      `
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
                `
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
    (requestedId && runsPayload.runs.find((run) => run.id === requestedId)) || runsPayload.runs[0];
  const eventsPayload = selectedRun
    ? await getJson<RunEventsPayload>(`/api/gateway/runs/${selectedRun.id}/events`)
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
                  const isActive = selectedRun && selectedRun.id === run.id;
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
                    `
                  )
                  .join('')}</ul>`
        }
      </article>
    </section>
  `);
}

async function render(): Promise<void> {
  try {
    const pathname = window.location.pathname;
    if (pathname === '/settings') {
      await renderSettings();
    } else if (pathname === '/review') {
      await renderReview();
    } else if (pathname === '/runs') {
      await renderRuns();
    } else if (pathname === '/audit') {
      await renderAudit();
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
