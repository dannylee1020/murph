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
    title: string;
    ownerUserId: string;
    mode: string;
    endsAt: string;
    channelScope: string[];
    contextSnapshot?: {
      builtAt: string;
      summary: string;
      warnings?: string[];
      sections: Array<{ source: string }>;
    };
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
};

type SetupCheckStatus = 'ok' | 'warning' | 'action_required' | 'error';

type SetupDoctorPayload = {
  ok: boolean;
  ready: boolean;
  nextStep: 'core' | 'ai' | 'slack_config' | 'slack_oauth' | 'identity' | 'channels' | 'ready';
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
  };
  discord: { installed: boolean; oauthConfigured: boolean; botTokenConfigured: boolean };
  provider: { configured: boolean; defaultProvider: string };
  notion: {
    configured: boolean;
    version: string;
  };
  userConfigured: boolean;
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
    status: 'connected' | 'disconnected';
    source?: 'database' | 'env';
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
    };
    errorMessage?: string;
  }>;
};

type GitHubRepositoriesPayload = {
  ok: boolean;
  error?: string;
  repositories: Array<{ fullName: string; private: boolean; owner: string; name: string }>;
  selectedRepositories: string[];
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
  session: { id: string; title: string; mode: string; status: string; stoppedAt?: string } | null;
  sessions: Array<{ id: string; title: string; mode: string; status: string; stoppedAt?: string; triageItemCount?: number }>;
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
        messages: Array<{ ts: string; authorId?: string; text: string }>;
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
  sessionContext?: { summary: string; warnings?: string[] };
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

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/review', label: 'Review' },
  { href: '/triage', label: 'Triage' },
  { href: '/activity', label: 'Activity' },
  { href: '/admin', label: 'Admin' }
];

type SlackMembersPayload = {
  ok: boolean;
  error?: string;
  members: Array<{ id: string; displayName: string; avatar?: string }>;
};

type SlackChannelsPayload = {
  ok: boolean;
  error?: string;
  channels: Array<{ id: string; name?: string; displayName: string; isMember: boolean; isPrivate: boolean }>;
};

type SetupWizardState = {
  currentStep: number;
  selectedUserId: string;
  selectedUserName: string;
  selectedChannelIds: string[];
  selectedChannels: Array<{ id: string; displayName: string }>;
  timezone: string;
  workdayStartHour: number;
};

let setupWizardState: SetupWizardState = {
  currentStep: 0,
  selectedUserId: '',
  selectedUserName: '',
  selectedChannelIds: [],
  selectedChannels: [],
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
  workdayStartHour: 9
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
    const parsed = JSON.parse(raw) as Array<{ id: string; displayName: string }>;
    return parsed.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.displayName === 'string');
  } catch {
    return [];
  }
}

function setSelectedChannels(channels: Array<{ id: string; displayName: string }>): void {
  localStorage.setItem('murph_selected_channels', JSON.stringify(channels));
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Request failed: ${path}`);
  }
  return (await response.json()) as T;
}

async function getSlackJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  return (await response.json().catch(() => ({ ok: false, error: `Request failed: ${path}` }))) as T;
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
      event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : null;
    if (!payload) continue;
    const id = typeof payload.id === 'string' ? payload.id : undefined;
    if (!id) continue;

    if (event.type === 'agent.tool.requested') {
      const entry: ToolCallEntry = {
        id,
        name: typeof payload.name === 'string' ? payload.name : 'unknown',
        requestedAt: event.createdAt,
        reason: typeof payload.reason === 'string' ? payload.reason : undefined,
        input: payload.input,
        status: 'pending'
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
          ? new Date(completedAt).getTime() - new Date(requestedAt).getTime()
          : undefined;
      const updated: ToolCallEntry = {
        id,
        name: typeof payload.name === 'string' ? payload.name : existing?.name ?? 'unknown',
        requestedAt,
        completedAt,
        durationMs: Number.isFinite(durationMs) && (durationMs ?? 0) >= 0 ? durationMs : undefined,
        reason: existing?.reason,
        input: existing?.input,
        status: ok ? 'ok' : 'error',
        outputSummary:
          typeof payload.outputSummary === 'string'
            ? payload.outputSummary
            : existing?.outputSummary,
        error: typeof payload.error === 'string' ? payload.error : existing?.error
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
  if (call.status === 'error') return '<span class="pill pill-warn">Error</span>';
  return '<span class="pill pill-muted">Pending</span>';
}

function renderToolCallEntry(call: ToolCallEntry): string {
  const inputJson =
    call.input === undefined ? '' : JSON.stringify(call.input, null, 2);
  const rows: string[] = [];
  if (call.reason) {
    rows.push(`<div><dt>Reason</dt><dd>${escapeHtml(call.reason)}</dd></div>`);
  }
  if (inputJson) {
    rows.push(`<div><dt>Input</dt><dd><pre>${escapeHtml(inputJson)}</pre></dd></div>`);
  }
  if (call.outputSummary) {
    rows.push(`<div><dt>Output</dt><dd><pre>${escapeHtml(call.outputSummary)}</pre></dd></div>`);
  }
  if (call.error) {
    rows.push(`<div><dt>Error</dt><dd><pre>${escapeHtml(call.error)}</pre></dd></div>`);
  }
  const startedAt = call.requestedAt ?? call.completedAt;
  if (startedAt) {
    rows.push(
      `<div><dt>Started</dt><dd title="${escapeHtml(formatExactIso(startedAt))}">${escapeHtml(formatRelative(startedAt))}</dd></div>`
    );
  }
  if (rows.length === 0) {
    rows.push('<div><dt>Detail</dt><dd>No additional payload recorded.</dd></div>');
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
  const meta = errorCount > 0 ? `${calls.length} · ${errorCount} error${errorCount === 1 ? '' : 's'}` : String(calls.length).padStart(2, '0');

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
  fallbackLabel: string
): string {
  return [
    `<option value="" ${selected ? '' : 'selected'}>${escapeHtml(fallbackLabel)}</option>`,
    ...profiles.map((profile) => `
      <option value="${escapeHtml(profile.name)}" ${profile.name === selected ? 'selected' : ''}>
        ${escapeHtml(profile.name)}
      </option>
    `)
  ].join('');
}

function policySummary(profileName: string, profileDescription: string | undefined, compiled: CompiledPolicyPayload): string {
  const rows = [
    ['Selected profile', profileName],
    ['Auto-send', compiled.allowAutoSend ? 'Allowed when session mode allows it' : 'Disabled'],
    ['Grounding', compiled.requireGroundingForFacts ? 'Required for factual replies' : 'Not required'],
    ['Review topics', compiled.alwaysQueueTopics.join(', ') || 'None'],
    ['Blocked topics', compiled.blockedTopics.join(', ') || 'None']
  ];
  return `
    <dl class="details policy-summary">
      ${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
    </dl>
    ${profileDescription ? `<p class="policy-note">${escapeHtml(profileDescription)}</p>` : ''}
  `;
}

function policyProfileList(profiles: PolicyProfilesPayload['profiles']): string {
  if (profiles.length === 0) {
    return '<p class="empty">No policy profiles were found in <code>policies/</code>.</p>';
  }

  return `
    <ul class="list policy-profile-list">
      ${profiles.map((profile) => `
        <li>
          <div class="list-row policy-profile-row">
            <strong>${escapeHtml(profile.name)}</strong>
            <span>${escapeHtml(profile.description)}</span>
          </div>
        </li>
      `).join('')}
    </ul>
  `;
}

function shell(content: string): void {
  const pathname = window.location.pathname;
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="/" data-link>
          <span class="brand-wordmark">Murph</span>
          <span class="brand-tag">Overnight autopilot</span>
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
        <div class="sidebar-foot">${escapeHtml(formatToday())}</div>
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

function sessionErrorHtml(): string {
  if (!dashboardError) {
    return '';
  }
  const error = dashboardError;
  dashboardError = '';
  return error;
}

function sessionCreateErrorHtml(payload: SessionCreateResponse): string {
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

function sessionScopeLabel(session: SummaryPayload['sessions'][number], channelNames: Map<string, string>): string {
  return session.channelScope.length > 0
    ? session.channelScope.map((id) => channelNames.get(id) ?? id).join(', ')
    : 'All accessible channels';
}

function activeSessionRows(
  sessions: SummaryPayload['sessions'],
  channelNames: Map<string, string>
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
            <span>${escapeHtml(sessionScopeLabel(session, channelNames))}</span>
            <span>${escapeHtml(session.contextSnapshot ? `Context ready: ${session.contextSnapshot.summary}` : 'Context pending')}</span>
            <button class="secondary stop-session" data-session-id="${escapeHtml(session.id)}">Stop</button>
          </div>
        </li>
      `
    )
    .join('')}</ul>`;
}

function githubRepositorySummary(integration: IntegrationStatusPayload['integrations'][number]): string {
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

function integrationCard(integration: IntegrationStatusPayload['integrations'][number], workspaceId: string): string {
  const connected = integration.status === 'connected';
  const installHref = integration.installPath
    ? `${integration.installPath}?workspaceId=${encodeURIComponent(workspaceId)}`
    : '';

  const detailRows: string[] = [];
  if (connected) {
    if (integration.metadata.account) {
      detailRows.push(`<div><dt>Account</dt><dd>${escapeHtml(integration.metadata.account)}</dd></div>`);
    } else if (integration.source === 'env') {
      detailRows.push(`<div><dt>Key</dt><dd>Set on this server</dd></div>`);
    } else if (integration.metadata.masked) {
      detailRows.push(`<div><dt>Key</dt><dd>${escapeHtml(integration.metadata.masked)}</dd></div>`);
    }
    if (integration.metadata.validatedAt) {
      detailRows.push(`<div><dt>Validated</dt><dd>${escapeHtml(formatRelative(integration.metadata.validatedAt))}</dd></div>`);
    }
    if (integration.provider === 'github') {
      detailRows.push(`<div><dt>Repositories</dt><dd>${escapeHtml(githubRepositorySummary(integration))}</dd></div>`);
    }
  } else {
    const authLabel = integration.authType === 'oauth' ? 'OAuth' : 'API key';
    detailRows.push(`<div><dt>Auth</dt><dd>${escapeHtml(authLabel)}</dd></div>`);
    if (integration.tools.length > 0) {
      const toolsLabel = integration.tools.length === 1 ? '1 tool' : `${integration.tools.length} tools`;
      detailRows.push(`<div><dt>Adds</dt><dd>${escapeHtml(toolsLabel)}</dd></div>`);
    }
  }

  const primaryLabel = connected
    ? integration.source === 'env' ? 'Override' : 'Reconnect'
    : 'Connect';
  const primaryCta = integration.authType === 'oauth' && installHref
    ? `<a class="button" href="${escapeHtml(installHref)}">${connected ? 'Reconnect' : 'Connect with Google'}</a>`
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
    'Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore',
    'Asia/Kolkata', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    'America/New_York', 'America/Chicago', 'America/Denver',
    'America/Los_Angeles', 'America/Sao_Paulo', 'Pacific/Auckland',
    'Australia/Sydney'
  ];
}

function timezoneLabel(tz: string): string {
  const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
  try {
    const offset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
    return `${city} (${offset})`;
  } catch {
    return city;
  }
}

function calculateDurationHours(endHour: number, timezone: string): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false });
  const currentHour = Number(formatter.format(now));
  let hoursUntil = endHour - currentHour;
  if (hoursUntil <= 0) hoursUntil += 24;
  return Math.max(1, Math.min(hoursUntil, 24));
}

function setupStepForNextStep(nextStep: SetupDoctorPayload['nextStep']): number {
  if (nextStep === 'ai') return 1;
  if (nextStep === 'slack_config') return 2;
  if (nextStep === 'slack_oauth') return 3;
  if (nextStep === 'identity') return 4;
  if (nextStep === 'channels') return 5;
  if (nextStep === 'ready') return 6;
  return 0;
}

function setupCheckList(checks: SetupDoctorPayload['checks']): string {
  return `
    <div class="setup-check-list">
      ${checks
        .filter((check) => ['ai_provider', 'slack_socket', 'slack_oauth_config', 'slack_installed', 'identity'].includes(check.id))
        .map((check) => `
          <div class="setup-check ${escapeHtml(check.status)}">
            <strong>${escapeHtml(check.label)}</strong>
            <span>${escapeHtml(check.message)}</span>
          </div>
        `)
        .join('')}
    </div>
  `;
}

async function renderSetup(): Promise<void> {
  setTitle('Murph Setup');
  if (setupWizardState.selectedChannels.length === 0) {
    setupWizardState.selectedChannels = getSelectedChannels();
    setupWizardState.selectedChannelIds = setupWizardState.selectedChannels.map((channel) => channel.id);
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('step') === 'slack' && params.get('success') === '1') {
    setupWizardState.currentStep = 4;
    history.replaceState(null, '', '/setup');
  }

  const [setup, doctor] = await Promise.all([
    getJson<SetupStatusPayload>('/api/setup/status'),
    getJson<SetupDoctorPayload>('/api/setup/doctor')
  ]);
  if (setupWizardState.currentStep === 0 && doctor.nextStep !== 'core') {
    setupWizardState.currentStep = setupStepForNextStep(doctor.nextStep);
  }
  if (setup.slack.installed && setupWizardState.currentStep < 4) {
    setupWizardState.currentStep = 4;
  }

  const step = setupWizardState.currentStep;
  const visibleStep = Math.max(1, step);
  const totalSteps = 6;

  const dots = `
    ${Array.from({ length: totalSteps }, (_, i) => {
      const current = visibleStep - 1;
      const cls = i < current ? 'wizard-dot completed' : i === current ? 'wizard-dot active' : 'wizard-dot';
      return `<span class="${cls}"></span>`;
    }).join('')}
    <span style="margin-left: 4px;">${String(visibleStep).padStart(2, '0')} / ${String(totalSteps).padStart(2, '0')}</span>
  `;

  let stepContent = '';

  if (step === 0) {
    stepContent = `
      <div class="wizard-step">
        <h1>Set up Murph</h1>
        <p>The installer got the server running. Finish the product setup here: add an AI key, connect Slack, pick yourself, and set your schedule.</p>
        ${setupCheckList(doctor.checks)}
        <div class="wizard-actions">
          <button type="button" id="wizard-next">Get started</button>
        </div>
      </div>
    `;
  } else if (step === 1) {
    stepContent = `
      <div class="wizard-step">
        <h1>Add an AI provider</h1>
        <p>Murph needs OpenAI or Anthropic before it can draft replies.</p>
        ${setup.provider.configured
          ? `<div class="setup-success">${escapeHtml(setup.provider.defaultProvider)} is configured</div>
             <div class="wizard-actions">
               <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
               <button type="button" id="wizard-next">Continue</button>
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
             </form>
             <div class="wizard-actions">
               <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
               <button type="button" id="wizard-next">Save and continue</button>
             </div>`
        }
      </div>
    `;
  } else if (step === 2) {
    stepContent = `
      <div class="wizard-step">
        <h1>Create the Slack app</h1>
        <p>Use the manifest at <code>docs/slack-socket-mode-manifest.yml</code>, enable Socket Mode, and confirm Slack lists <code>http://localhost:5173/api/slack/oauth/callback</code> under Redirect URLs.</p>
        ${setup.slack.socketConfigured && setup.slack.oauthConfigured
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
        <div class="wizard-actions">
          <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
          <button type="button" id="wizard-next">${setup.slack.socketConfigured && setup.slack.oauthConfigured ? 'Continue' : 'Save and continue'}</button>
        </div>
      </div>
    `;
  } else if (step === 3) {
    stepContent = `
      <div class="wizard-step">
        <h1>Connect Slack workspace</h1>
        <p>Murph needs access to your Slack workspace to watch channels while you're away.</p>
        ${setup.slack.installed
          ? `<div class="setup-success">Slack connected</div>
             <div class="wizard-actions">
               <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
               <button type="button" id="wizard-next">Continue</button>
             </div>`
          : `<div class="wizard-actions">
               <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
               ${setup.slack.oauthConfigured
                 ? '<a class="button" href="/api/slack/install">Connect Slack workspace</a>'
                 : '<button type="button" id="wizard-next" disabled>Add Slack credentials first</button>'
               }
             </div>`
        }
      </div>
    `;
  } else if (step === 4) {
    stepContent = `
      <div class="wizard-step">
        <h1>Which one are you?</h1>
        <p>Pick yourself from the list so Murph knows who to watch for.</p>
        <div id="member-list-container"><p class="empty">Loading team members...</p></div>
        <div class="wizard-actions">
          <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
          <button type="button" id="wizard-next" disabled>Continue</button>
        </div>
      </div>
    `;
  } else if (step === 5) {
    stepContent = `
      <div class="wizard-step">
        <h1>Which channels should Murph watch?</h1>
        <p>Pick the channels you want covered overnight. Public channels can be joined automatically. Private channels must already include the Slack app.</p>
        <div id="channel-list-container"><p class="empty">Loading channels...</p></div>
        <div class="wizard-actions">
          <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
          <button type="button" id="wizard-next" disabled>Continue</button>
        </div>
      </div>
    `;
  } else if (step === 6) {
    stepContent = `
      <div class="wizard-step">
        <h1>Set your schedule</h1>
        <p>When do you usually start your day? Murph will watch until then.</p>
        <form class="form" id="schedule-form">
          <label>
            <span>Timezone</span>
            <select name="timezone">
              ${getTimezoneOptions().map((tz) => `<option value="${escapeHtml(tz)}" ${tz === setupWizardState.timezone ? 'selected' : ''}>${escapeHtml(timezoneLabel(tz))}</option>`).join('')}
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
          <span class="wizard-brand">Murph</span>
          ${step > 0 ? `<div class="wizard-progress-dots">${dots}</div>` : ''}
        </div>
        ${stepContent}
      </div>
    </div>
  `;

  if (step === 4) {
    const container = app.querySelector<HTMLDivElement>('#member-list-container');
    try {
      const membersPayload = await getSlackJson<SlackMembersPayload>('/api/slack/members');
      if (membersPayload.ok && membersPayload.members.length > 0) {
        container!.innerHTML = `
          <div class="member-list">
            ${membersPayload.members.map((m) => `
              <div class="member-item" data-user-id="${escapeHtml(m.id)}" data-user-name="${escapeHtml(m.displayName)}">
                ${m.avatar ? `<img src="${escapeHtml(m.avatar)}" alt="" />` : `<span class="member-avatar-placeholder">${escapeHtml(m.displayName.charAt(0).toUpperCase())}</span>`}
                <span>${escapeHtml(m.displayName)}</span>
              </div>
            `).join('')}
          </div>
        `;
        container!.querySelectorAll<HTMLDivElement>('.member-item').forEach((item) => {
          item.addEventListener('click', () => {
            container!.querySelectorAll('.member-item').forEach((el) => el.classList.remove('selected'));
            item.classList.add('selected');
            setupWizardState.selectedUserId = item.dataset.userId ?? '';
            setupWizardState.selectedUserName = item.dataset.userName ?? '';
            const nextBtn = app.querySelector<HTMLButtonElement>('#wizard-next');
            if (nextBtn) nextBtn.disabled = false;
          });
        });
      } else if (membersPayload.error === 'slack_reconnect_required' || membersPayload.error === 'no_workspace') {
        container!.innerHTML = `
          <p class="empty">Reconnect Slack before choosing yourself.</p>
          <a class="button" href="/api/slack/install">Connect Slack workspace</a>
        `;
      } else {
        container!.innerHTML = `
          <form class="form" id="manual-name-form">
            <label><span>Your name</span><input name="displayName" placeholder="e.g. Danny" required /></label>
          </form>
        `;
        const nextBtn = app.querySelector<HTMLButtonElement>('#wizard-next');
        if (nextBtn) nextBtn.disabled = false;
        const nameInput = container!.querySelector<HTMLInputElement>('input[name="displayName"]');
        nameInput?.addEventListener('input', () => {
          setupWizardState.selectedUserName = nameInput.value.trim();
          setupWizardState.selectedUserId = nameInput.value.trim().toLowerCase().replace(/\s+/g, '_');
        });
      }
    } catch {
      container!.innerHTML = `
        <form class="form" id="manual-name-form">
          <label><span>Your name</span><input name="displayName" placeholder="e.g. Danny" required /></label>
        </form>
      `;
      const nextBtn = app.querySelector<HTMLButtonElement>('#wizard-next');
      if (nextBtn) nextBtn.disabled = false;
      const nameInput = container!.querySelector<HTMLInputElement>('input[name="displayName"]');
      nameInput?.addEventListener('input', () => {
        setupWizardState.selectedUserName = nameInput.value.trim();
        setupWizardState.selectedUserId = nameInput.value.trim().toLowerCase().replace(/\s+/g, '_');
      });
    }
  }

  if (step === 5) {
    const container = app.querySelector<HTMLDivElement>('#channel-list-container');
    const nextBtn = app.querySelector<HTMLButtonElement>('#wizard-next');
    try {
      const channelsPayload = await getSlackJson<SlackChannelsPayload>('/api/slack/channels');
      if (channelsPayload.ok && channelsPayload.channels.length > 0) {
        container!.innerHTML = `
          <div class="member-list">
            ${channelsPayload.channels.map((channel) => {
              const selected = setupWizardState.selectedChannelIds.includes(channel.id);
              const badge = channel.isPrivate ? 'Private' : channel.isMember ? 'Joined' : 'Public';
              return `
                <label class="member-item channel-item ${selected ? 'selected' : ''}">
                  <input type="checkbox" name="setupChannelScope" value="${escapeHtml(channel.id)}" ${selected ? 'checked' : ''} />
                  <span class="member-avatar-placeholder">${escapeHtml(channel.displayName.replace('#', '').charAt(0).toUpperCase())}</span>
                  <span class="channel-copy">
                    <strong>${escapeHtml(channel.displayName)}</strong>
                    <small>${escapeHtml(badge)}</small>
                  </span>
                </label>
              `;
            }).join('')}
          </div>
        `;

        const syncSelection = () => {
          const selectedChannels = channelsPayload.channels
            .filter((channel) => {
              const input = container!.querySelector<HTMLInputElement>(`input[value="${CSS.escape(channel.id)}"]`);
              return Boolean(input?.checked);
            })
            .map((channel) => ({ id: channel.id, displayName: channel.displayName }));
          setupWizardState.selectedChannels = selectedChannels;
          setupWizardState.selectedChannelIds = selectedChannels.map((channel) => channel.id);
          if (nextBtn) nextBtn.disabled = selectedChannels.length === 0;
          container!.querySelectorAll<HTMLLabelElement>('.channel-item').forEach((item) => {
            const input = item.querySelector<HTMLInputElement>('input');
            item.classList.toggle('selected', Boolean(input?.checked));
          });
        };

        container!.querySelectorAll<HTMLInputElement>('input[name="setupChannelScope"]').forEach((input) => {
          input.addEventListener('change', syncSelection);
        });
        syncSelection();
      } else if (channelsPayload.error === 'slack_reconnect_required' || channelsPayload.error === 'no_workspace') {
        container!.innerHTML = `
          <p class="empty">Reconnect Slack before choosing channels.</p>
          <a class="button" href="/api/slack/install">Connect Slack workspace</a>
        `;
        if (nextBtn) nextBtn.disabled = true;
      } else {
        container!.innerHTML = '<p class="empty">No Slack channels were available yet. You can keep going and watch all accessible channels.</p>';
        if (nextBtn) nextBtn.disabled = false;
      }
    } catch {
      container!.innerHTML = '<p class="empty">Murph could not load Slack channels right now. You can keep going and watch all accessible channels.</p>';
      if (nextBtn) nextBtn.disabled = false;
    }
  }

  app.querySelector<HTMLButtonElement>('#wizard-next')?.addEventListener('click', async () => {
    if (step === 1 && !setup.provider.configured) {
      const form = app.querySelector<HTMLFormElement>('#ai-provider-form');
      const formData = form ? new FormData(form) : new FormData();
      const provider = String(formData.get('provider') ?? 'openai');
      const apiKey = String(formData.get('apiKey') ?? '').trim();
      if (!apiKey) return;
      await postJson('/api/setup/env', {
        MURPH_DEFAULT_PROVIDER: provider,
        ...(provider === 'anthropic' ? { ANTHROPIC_API_KEY: apiKey } : { OPENAI_API_KEY: apiKey })
      });
    }

    if (step === 2 && !(setup.slack.socketConfigured && setup.slack.oauthConfigured)) {
      const form = app.querySelector<HTMLFormElement>('#slack-config-form');
      const formData = form ? new FormData(form) : new FormData();
      const appToken = String(formData.get('appToken') ?? '').trim();
      const clientId = String(formData.get('clientId') ?? '').trim();
      const clientSecret = String(formData.get('clientSecret') ?? '').trim();
      if ((!setup.slack.socketConfigured && !appToken) || (!setup.slack.oauthConfigured && (!clientId || !clientSecret))) return;
      await postJson('/api/setup/env', {
        SLACK_EVENTS_MODE: 'socket',
        SLACK_APP_TOKEN: appToken,
        SLACK_CLIENT_ID: clientId,
        SLACK_CLIENT_SECRET: clientSecret
      });
    }

    if (step === 4 && !setupWizardState.selectedUserId) return;
    if (step === 5 && setupWizardState.selectedChannelIds.length === 0) {
      setupWizardState.selectedChannels = [];
    }

    if (step === 6) {
      const form = app.querySelector<HTMLFormElement>('#schedule-form');
      if (form) {
        const formData = new FormData(form);
        setupWizardState.timezone = String(formData.get('timezone') ?? setupWizardState.timezone);
        const timeVal = String(formData.get('startTime') ?? '09:00');
        setupWizardState.workdayStartHour = Number(timeVal.split(':')[0]);
      }

      await putJson(`/api/gateway/users/${encodeURIComponent(setupWizardState.selectedUserId)}/schedule`, {
        displayName: setupWizardState.selectedUserName,
        timezone: setupWizardState.timezone,
        workdayStartHour: setupWizardState.workdayStartHour,
        workdayEndHour: setupWizardState.workdayStartHour + 8
      });

      setCurrentUser(setupWizardState.selectedUserId, setupWizardState.selectedUserName);
      setSelectedChannels(setupWizardState.selectedChannels);
      history.replaceState(null, '', '/');
      await render();
      return;
    }

    setupWizardState.currentStep++;
    await renderSetup();
  });

  app.querySelector<HTMLButtonElement>('#wizard-back')?.addEventListener('click', async () => {
    setupWizardState.currentStep = Math.max(0, setupWizardState.currentStep - 1);
    await renderSetup();
  });
}

async function renderDashboard(): Promise<void> {
  setTitle('Murph');
  loading('Home');
  const [data, setupStatus] = await Promise.all([
    getJson<SummaryPayload>('/api/gateway/summary'),
    getJson<SetupStatusPayload>('/api/setup/status')
  ]);

  const currentUser = data.users.find((u) => u.externalUserId === getCurrentUserId());
  const selectedChannels = getSelectedChannels();
  const selectedChannelIds = selectedChannels.map((channel) => channel.id);
  const selectedChannelNames = new Map(selectedChannels.map((channel) => [channel.id, channel.displayName]));
  const userTz = currentUser?.schedule?.timezone ?? setupWizardState.timezone;
  const userStartHour = currentUser?.schedule?.workdayStartHour ?? setupWizardState.workdayStartHour;
  const estimatedHours = calculateDurationHours(userStartHour, userTz);
  const providerBanner = !setupStatus.provider.configured
    ? `<div class="setup-banner">
        <p>Connect an AI provider to let Murph draft replies for you.</p>
        <a class="button secondary" href="/admin">Configure</a>
      </div>`
    : '';

  shell(`
    <section class="page-head">
      <p class="eyebrow">${escapeHtml(formatToday())} · ${escapeHtml(formatSessionStatus(data.summary.activeSessionCount))}</p>
      <h1>Home</h1>
    </section>

    ${providerBanner}
    ${sessionFeedbackHtml()}
    ${sessionErrorHtml()}

    <section>
      <article class="panel go-to-sleep-card">
        <h2>Go to sleep</h2>
        <p>Murph will watch your accessible channels and queue drafts for your review.</p>
        <form id="go-to-sleep-form">
          <dl class="go-to-sleep-summary">
            <div class="summary-cell">
              <dt>Watching</dt>
              <dd>${selectedChannels.length > 0 ? selectedChannels.map((channel) => escapeHtml(channel.displayName)).join(', ') : 'All accessible channels'}</dd>
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
          <button type="submit" class="primary-large">Start watching</button>

          <details class="customize-section">
            <summary>Customize</summary>
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
                    ${getTimezoneOptions().map((tz) => `<option value="${escapeHtml(tz)}" ${tz === userTz ? 'selected' : ''}>${escapeHtml(timezoneLabel(tz))}</option>`).join('')}
                  </select>
                </label>
              </div>
            </fieldset>
          </details>
        </form>

        <section class="active-session-inline">
          <div class="section-head">
            <h2>Currently watching</h2>
            <span class="section-meta">${escapeHtml(formatSessionStatus(data.summary.activeSessionCount))}</span>
          </div>
          ${activeSessionRows(data.sessions, selectedChannelNames)}
        </section>
      </article>
    </section>
  `);

  app.querySelector<HTMLFormElement>('#go-to-sleep-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);

    const mode = String(formData.get('mode') ?? 'manual_review');
    const endTimeVal = String(formData.get('endTime') ?? `${String(userStartHour).padStart(2, '0')}:00`);
    const endHour = Number(endTimeVal.split(':')[0]);
    const tz = String(formData.get('timezone') ?? userTz);

    try {
      const response = await postJson<SessionCreateResponse>('/api/gateway/sessions', {
        ownerUserId: getCurrentUserId(),
        title: 'Watching overnight',
        mode,
        channelScope: selectedChannelIds,
        durationHours: calculateDurationHours(endHour, tz)
      });
      dashboardError = '';
      dashboardNotice = response.sessionContext?.warnings?.length
        ? `Murph is watching. Session context built with ${response.sessionContext.warnings.length} warning${response.sessionContext.warnings.length === 1 ? '' : 's'}.`
        : `Murph is watching. ${response.sessionContext?.summary ?? 'Session context is ready.'}`;
      await renderDashboard();
    } catch (error) {
      if (error instanceof ApiError) {
        dashboardNotice = '';
        dashboardError = sessionCreateErrorHtml(error.payload as SessionCreateResponse);
        await renderDashboard();
      } else {
        throw error;
      }
    }
  });

  app.querySelectorAll<HTMLButtonElement>('.stop-session').forEach((button) => {
    button.addEventListener('click', async () => {
      await postJson(`/api/gateway/sessions/${button.dataset.sessionId}/stop`);
      dashboardNotice = 'Session stopped.';
      await renderDashboard();
    });
  });
}

async function renderSettings(): Promise<void> {
  setTitle('Murph Admin');
  loading('Admin');

  const params = new URLSearchParams(window.location.search);
  let settingsNotice = '';
  if (params.get('error') === 'google_not_configured') {
    settingsNotice = '<div class="notice danger">Google OAuth is not configured. Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> environment variables.</div>';
  } else if (params.get('google') === 'connected') {
    settingsNotice = '<div class="notice success">Google account connected.</div>';
  }
  if (settingsNotice) {
    history.replaceState(null, '', '/settings');
  }

  const [summary, setup, integrationsPayload, policyConfig] = await Promise.all([
    getJson<SummaryPayload>('/api/gateway/summary'),
    getJson<SetupStatusPayload>('/api/setup/status'),
    getJson<IntegrationStatusPayload>('/api/integrations/status'),
    getJson<PolicyConfigPayload>('/api/gateway/policy/config')
  ]);

  shell(`
    ${settingsNotice}
    ${sessionFeedbackHtml()}
    <section class="page-head">
      <p class="eyebrow">Setup</p>
      <h1>Admin</h1>
      <p>Connect the services Murph needs to watch messages and draft useful replies.</p>
    </section>

    <dl class="kpis">
      ${metric('Workspace', summary.summary.workspace?.name ?? 'Not installed')}
      ${metric('AI provider', setup.provider.configured ? `${setup.provider.defaultProvider}` : 'Not configured')}
      ${metric('Slack', setup.slack.installed ? 'Connected' : 'Not connected')}
      ${metric('Discord', setup.discord.installed ? 'Connected' : 'Not connected')}
    </dl>

    <section class="grid three">
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
        <h2><span class="status-dot ${setup.discord.installed && setup.discord.oauthConfigured && setup.discord.botTokenConfigured ? 'ok' : 'off'}" aria-hidden="true"></span>Discord</h2>
        <p>Connect Discord if this workspace also needs async coverage there.</p>
        <dl class="details">
          <div><dt>Status</dt><dd>${setup.discord.installed ? 'Connected' : 'Not connected'}</dd></div>
          <div><dt>Setup</dt><dd>${setup.discord.oauthConfigured && setup.discord.botTokenConfigured ? 'Ready to install' : 'Missing server settings'}</dd></div>
        </dl>
        <div class="actions">
          ${
            setup.discord.oauthConfigured && setup.discord.botTokenConfigured
              ? `<a class="button" href="/api/discord/install">${setup.discord.installed ? 'Reconnect Discord' : 'Connect Discord'}</a>`
              : '<span class="empty">Discord OAuth or bot token is not configured.</span>'
          }
        </div>
      </article>
      <article class="panel panel-status">
        <h2><span class="status-dot ${setup.provider.configured ? 'ok' : 'off'}" aria-hidden="true"></span>AI provider</h2>
        <p>Add an OpenAI or Anthropic key so Murph can draft replies.</p>
        <dl class="details">
          <div><dt>Status</dt><dd>${setup.provider.configured ? 'Connected' : 'Missing API key'}</dd></div>
          <div><dt>Default</dt><dd>${escapeHtml(setup.provider.defaultProvider)}</dd></div>
        </dl>
      </article>
    </section>

    <section>
      <div class="policy-assignment">
        <article class="policy-editor-panel">
          <h2>Policy</h2>
          <p class="section-copy">Choose the policy Murph uses for new sessions. Edit profiles in YAML; CLI and agent-managed editing can come later.</p>
          <form class="form compact-form" id="policy-form">
            <label>
              Policy profile
              <select name="profileName">
                ${policyProfileOptions(policyConfig.profiles, policyConfig.policyProfileName, 'Built-in mode default')}
              </select>
            </label>
            <div class="actions">
              <button type="submit">Save policy</button>
            </div>
          </form>
        </article>

        <article class="policy-preview">
          <h2>Effective policy</h2>
          ${policySummary(policyConfig.selectedProfileName, policyConfig.selectedProfile.description, policyConfig.compiled)}
        </article>

        <article class="policy-preview policy-library">
          <h2>Available profiles</h2>
          ${policyProfileList(policyConfig.profiles)}
        </article>
      </div>
    </section>

    <section>
      <h2>Integrations</h2>
      <p class="section-copy">Connect optional sources Murph can use for more grounded replies.</p>
      <div class="grid two">
        ${integrationsPayload.integrations.map((i) => integrationCard(i, integrationsPayload.workspaceId)).join('')}
      </div>
    </section>

    ${githubRepositoryDialog(integrationsPayload.workspaceId)}
  `);

  const integrationsByProvider = new Map(integrationsPayload.integrations.map((integration) => [integration.provider, integration]));

  app.querySelector<HTMLFormElement>('#policy-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    await putJson('/api/gateway/policy/config', {
      profileName: String(formData.get('profileName') ?? '')
    });
    dashboardNotice = 'Policy saved.';
    await renderSettings();
  });

  async function loadGithubRepositories(): Promise<void> {
    const picker = app.querySelector<HTMLDivElement>('.github-repo-picker');
    const workspaceId = picker?.dataset.workspaceId ?? integrationsPayload.workspaceId;
    const listEl = picker?.querySelector<HTMLDivElement>('.github-repo-list');
    const saveButton = picker?.querySelector<HTMLButtonElement>('.save-github-repos');
    if (!picker || !listEl || !saveButton) return;

    listEl.innerHTML = '<p class="empty">Loading repositories...</p>';
    saveButton.disabled = true;
    try {
      const payload = await getJson<GitHubRepositoriesPayload>(
        `/api/integrations/github/repositories?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      if (!payload.ok) {
        listEl.innerHTML = `<p class="empty">${escapeHtml(payload.error ?? 'Could not load GitHub repositories.')}</p>`;
        return;
      }

      const selected = new Set(payload.selectedRepositories);
      listEl.innerHTML = payload.repositories.length > 0
        ? `<div class="member-list">
            ${payload.repositories.map((repo) => `
              <label class="member-item channel-item ${selected.has(repo.fullName) ? 'selected' : ''}">
                <input type="checkbox" name="githubRepository" value="${escapeHtml(repo.fullName)}" ${selected.has(repo.fullName) ? 'checked' : ''} />
                <span class="member-avatar-placeholder">${escapeHtml(repo.owner.charAt(0).toUpperCase())}</span>
                <span class="channel-copy">
                  <strong>${escapeHtml(repo.fullName)}</strong>
                  <small>${repo.private ? 'Private' : 'Public'}</small>
                </span>
              </label>
            `).join('')}
          </div>`
        : '<p class="empty">No GitHub repositories were visible to this token.</p>';

      const sync = () => {
        saveButton.disabled = false;
        listEl.querySelectorAll<HTMLLabelElement>('.channel-item').forEach((item) => {
          const input = item.querySelector<HTMLInputElement>('input');
          item.classList.toggle('selected', Boolean(input?.checked));
        });
      };
      listEl.querySelectorAll<HTMLInputElement>('input[name="githubRepository"]').forEach((input) => {
        input.addEventListener('change', sync);
      });
    } catch (error) {
      listEl.innerHTML = `<p class="empty">${escapeHtml(error instanceof Error ? error.message : 'Could not load GitHub repositories.')}</p>`;
    }
  }

  app.querySelector<HTMLButtonElement>('.manage-github-repos')?.addEventListener('click', async () => {
    const dialog = app.querySelector<HTMLDialogElement>('#github-repo-dialog');
    dialog?.showModal();
    await loadGithubRepositories();
  });

  app.querySelectorAll<HTMLButtonElement>('.close-github-repos').forEach((button) => {
    button.addEventListener('click', () => {
      app.querySelector<HTMLDialogElement>('#github-repo-dialog')?.close();
    });
  });

  app.querySelector<HTMLDialogElement>('#github-repo-dialog')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
      (event.currentTarget as HTMLDialogElement).close();
    }
  });

  app.querySelectorAll<HTMLButtonElement>('.save-github-repos').forEach((button) => {
    button.addEventListener('click', async () => {
      const picker = button.closest<HTMLDivElement>('.github-repo-picker');
      if (!picker) {
        return;
      }
      const workspaceId = picker.dataset.workspaceId ?? integrationsPayload.workspaceId;
      const repositories = Array.from(picker.querySelectorAll<HTMLInputElement>('input[name="githubRepository"]:checked'))
        .map((input) => input.value);
      button.disabled = true;
      try {
        await putJson('/api/integrations/github/repositories', { workspaceId, repositories });
        dashboardNotice = repositories.length > 0 ? 'GitHub repositories saved.' : 'GitHub retrieval disabled until repositories are selected.';
        app.querySelector<HTMLDialogElement>('#github-repo-dialog')?.close();
        await renderSettings();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Could not save GitHub repositories.');
        button.disabled = false;
      }
    });
  });

  app.querySelectorAll<HTMLButtonElement>('.connect-integration').forEach((button) => {
    button.addEventListener('click', async () => {
      const provider = button.dataset.provider ?? '';
      const integration = integrationsByProvider.get(provider);
      const name = integration?.name ?? provider;
      const label = integration?.credentialLabel ?? 'API key';
      const credential = window.prompt(`Enter your ${name} ${label.toLowerCase()}`);
      if (!credential) {
        return;
      }

      try {
        await postJson(`/api/integrations/${encodeURIComponent(provider)}/connect`, {
          workspaceId: integrationsPayload.workspaceId,
          credential
        });
        dashboardNotice = `Connected ${name}.`;
        await renderSettings();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Integration could not be connected.');
      }
    });
  });

  app.querySelectorAll<HTMLButtonElement>('.disconnect-integration').forEach((button) => {
    button.addEventListener('click', async () => {
      const provider = button.dataset.provider ?? '';
      const integration = integrationsByProvider.get(provider);
      const name = integration?.name ?? provider;
      const disconnectUrl = integration?.authType === 'oauth'
        ? `/api/${encodeURIComponent(provider)}/disconnect?workspaceId=${encodeURIComponent(integrationsPayload.workspaceId)}`
        : `/api/integrations/${encodeURIComponent(provider)}/disconnect?workspaceId=${encodeURIComponent(integrationsPayload.workspaceId)}`;
      const response = await fetch(disconnectUrl, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        window.alert(payload.error ?? 'Integration could not be disconnected.');
        return;
      }
      dashboardNotice = `Disconnected ${name}.`;
      await renderSettings();
    });
  });
}

async function renderReview(): Promise<void> {
  setTitle('Murph Review Queue');
  loading('Review Queue');
  const queuePayload = await getJson<QueuePayload>('/api/gateway/queue');

  shell(`
    <section class="page-head">
      <p class="eyebrow">Manual review</p>
      <h1>Review Queue</h1>
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

function dispositionPill(disposition: string | undefined): string {
  if (disposition === 'auto_sent') return '<span class="pill pill-ok">Auto-sent</span>';
  if (disposition === 'abstained') return '<span class="pill pill-muted">Abstained</span>';
  return `<span class="pill pill-muted">${escapeHtml(titleCase(disposition ?? 'unknown'))}</span>`;
}

function renderTriageItem(item: TriagePayload['items'][number]): string {
  const messages = item.contextSnapshot?.thread.messages ?? [];
  const excerpt = messages.at(-1)?.text ?? item.message ?? item.reason;
  const confidence = typeof item.confidence === 'number' ? `${Math.round(item.confidence * 100)}%` : '—';

  return `
    <article class="panel">
      <h2>${dispositionPill(item.disposition)} ${escapeHtml(item.channelId)} / ${escapeHtml(item.threadTs)}</h2>
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

function renderTriageSessionLink(session: TriagePayload['sessions'][number], selectedSessionId: string | undefined): string {
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
  const selectedSessionId = new URLSearchParams(window.location.search).get('sessionId');
  const payload = await getJson<TriagePayload>(
    `/api/gateway/triage${selectedSessionId ? `?sessionId=${encodeURIComponent(selectedSessionId)}` : ''}`
  );
  const grouped = new Map<string, TriagePayload['items']>();
  for (const item of payload.items) {
    const items = grouped.get(item.channelId) ?? [];
    items.push(item);
    grouped.set(item.channelId, items);
  }

  shell(`
    <section class="page-head">
      <p class="eyebrow">Morning catchup</p>
      <h1>Triage</h1>
      <p>${escapeHtml(
        payload.session
          ? `${payload.session.title} (${sessionModeLabel(payload.session.mode)})`
          : 'No completed sessions yet.'
      )}</p>
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
                  `
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

async function renderActivity(): Promise<void> {
  setTitle('Murph Activity');
  loading('Activity');
  const [runsPayload, auditPayload, tracePayload] = await Promise.all([
    getJson<RunsPayload>('/api/gateway/runs'),
    getJson<AuditPayload>('/api/gateway/audit'),
    getJson<TracesPayload>('/api/gateway/traces')
  ]);

  const requestedId = new URL(window.location.href).searchParams.get('id');
  const selectedRun =
    (requestedId && runsPayload.runs.find((run) => run.id === requestedId)) || undefined;
  const eventsPayload = selectedRun
    ? await getJson<RunEventsPayload>(`/api/gateway/runs/${selectedRun.id}/events`)
    : { events: [] };

  shell(`
    <section class="page-head">
      <p class="eyebrow">Activity log</p>
      <h1>Activity</h1>
      <p>Runs, decisions, and traces from Murph's operations.</p>
    </section>

    <section class="grid two">
      <article class="panel">
        <h2>Recent Runs</h2>
        ${
          runsPayload.runs.length === 0
            ? '<p class="empty">Agent runs appear here once a message triggers the gateway.</p>'
            : `<ul class="list">${runsPayload.runs
                .map((run) => {
                  const isActive = selectedRun && selectedRun.id === run.id;
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
            <article class="panel">
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
                        `
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
                      `
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
                `
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

    const setupStatus = await getJson<SetupStatusPayload>('/api/setup/status');
    if (!setupStatus.slack.installed || !setupStatus.userConfigured) {
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
