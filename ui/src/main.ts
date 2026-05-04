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
  userConfigured: boolean;
};

type IntegrationStatusPayload = {
  ok: boolean;
  workspaceId: string;
  integrations: Array<{
    provider: string;
    name: string;
    authType: string;
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
    };
    errorMessage?: string;
  }>;
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
let dashboardError = '';

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/review', label: 'Review' },
  { href: '/activity', label: 'Activity' },
  { href: '/admin', label: 'Admin' }
];

type SlackMembersPayload = {
  ok: boolean;
  members: Array<{ id: string; displayName: string; avatar?: string }>;
};

type SlackChannelsPayload = {
  ok: boolean;
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

function integrationStatusLabel(integration: IntegrationStatusPayload['integrations'][number]): string {
  if (integration.status !== 'connected') {
    return 'Not connected';
  }
  return integration.source === 'env' ? 'Connected via environment' : 'Connected';
}

function integrationDescription(integration: IntegrationStatusPayload['integrations'][number]): string {
  if (integration.provider === 'github') {
    return 'Connect issues, pull requests, and repository context.';
  }
  if (integration.provider === 'notion') {
    return 'Connect docs and team knowledge pages.';
  }
  return 'Connect this service so Murph can use it for better replies.';
}

function integrationCredentialLabel(integration: IntegrationStatusPayload['integrations'][number]): string {
  if (integration.status !== 'connected') {
    return 'Not connected';
  }
  if (integration.source === 'env') {
    return 'Set on this server';
  }
  return integration.metadata.masked ?? 'Saved in Murph';
}

function integrationCard(integration: IntegrationStatusPayload['integrations'][number]): string {
  const connected = integration.status === 'connected';
  const metadata = [
    integration.metadata.account ? `Account: ${integration.metadata.account}` : '',
    integration.metadata.masked ? `Key: ${integration.metadata.masked}` : '',
    integration.metadata.validatedAt ? `Validated ${formatRelative(integration.metadata.validatedAt)}` : ''
  ].filter(Boolean);

  return `
    <article class="panel panel-status">
      <h2><span class="status-dot ${connected ? 'ok' : 'off'}" aria-hidden="true"></span>${escapeHtml(integration.name)}</h2>
      <p>${escapeHtml(integrationDescription(integration))}</p>
      <dl class="details">
        <div><dt>Status</dt><dd>${escapeHtml(integrationStatusLabel(integration))}</dd></div>
        <div><dt>Key</dt><dd>${escapeHtml(integrationCredentialLabel(integration))}</dd></div>
      </dl>
      ${metadata.length > 0 ? `<p class="empty">${escapeHtml(metadata.join(' · '))}</p>` : ''}
      <div class="actions">
        <button type="button" class="connect-integration" data-provider="${escapeHtml(integration.provider)}">${connected && integration.source === 'env' ? 'Override' : 'Connect'}</button>
        ${integration.canDisconnect ? `<button type="button" class="secondary disconnect-integration" data-provider="${escapeHtml(integration.provider)}">Disconnect</button>` : ''}
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

async function renderSetup(): Promise<void> {
  setTitle('Murph Setup');
  if (setupWizardState.selectedChannels.length === 0) {
    setupWizardState.selectedChannels = getSelectedChannels();
    setupWizardState.selectedChannelIds = setupWizardState.selectedChannels.map((channel) => channel.id);
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('step') === 'slack' && params.get('success') === '1') {
    setupWizardState.currentStep = 2;
    history.replaceState(null, '', '/setup');
  }

  const setup = await getJson<SetupStatusPayload>('/api/setup/status');
  if (setup.slack.installed && setupWizardState.currentStep < 2) {
    setupWizardState.currentStep = 2;
  }

  const step = setupWizardState.currentStep;
  const totalSteps = 5;

  const dots = `
    ${Array.from({ length: totalSteps }, (_, i) => {
      const cls = i < step ? 'wizard-dot completed' : i === step ? 'wizard-dot active' : 'wizard-dot';
      return `<span class="${cls}"></span>`;
    }).join('')}
    <span style="margin-left: 4px;">${String(step + 1).padStart(2, '0')} / ${String(totalSteps).padStart(2, '0')}</span>
  `;

  let stepContent = '';

  if (step === 0) {
    stepContent = `
      <div class="wizard-step">
        <h1>Murph watches your team chat while you sleep</h1>
        <p>Set up takes about 2 minutes. You'll connect Slack, pick your identity, and set your schedule.</p>
        <div class="wizard-actions">
          <button type="button" id="wizard-next">Get started</button>
        </div>
      </div>
    `;
  } else if (step === 1) {
    stepContent = `
      <div class="wizard-step">
        <h1>Connect Slack</h1>
        <p>Murph needs access to your Slack workspace to watch channels while you're away.</p>
        ${setup.slack.installed
          ? `<div class="setup-success">Slack connected</div>
             <div class="wizard-actions">
               <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
               <button type="button" id="wizard-next">Continue</button>
             </div>`
          : `<div class="wizard-actions">
               <button type="button" class="secondary back-btn" id="wizard-back">Back</button>
               <a class="button" href="/api/slack/install">Connect Slack workspace</a>
             </div>`
        }
      </div>
    `;
  } else if (step === 2) {
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
  } else if (step === 3) {
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
  } else if (step === 4) {
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

  if (step === 2) {
    const container = app.querySelector<HTMLDivElement>('#member-list-container');
    try {
      const membersPayload = await getJson<SlackMembersPayload>('/api/slack/members');
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

  if (step === 3) {
    const container = app.querySelector<HTMLDivElement>('#channel-list-container');
    const nextBtn = app.querySelector<HTMLButtonElement>('#wizard-next');
    try {
      const channelsPayload = await getJson<SlackChannelsPayload>('/api/slack/channels');
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
    if (step === 2 && !setupWizardState.selectedUserId) return;
    if (step === 3 && setupWizardState.selectedChannelIds.length === 0) {
      setupWizardState.selectedChannels = [];
    }

    if (step === 4) {
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
  const [data, recurring, policyProfilesPayload, runtime, setupStatus] = await Promise.all([
    getJson<SummaryPayload>('/api/gateway/summary'),
    getJson<RecurringJobsPayload>('/api/gateway/recurring-jobs'),
    getJson<PolicyProfilesPayload>('/api/gateway/policy-profiles'),
    getJson<RuntimePayload>('/api/gateway/runtime'),
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

    <section class="grid two">
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
      </article>

      <article class="panel">
        <h2>Active sessions</h2>
        ${list(
          data.sessions.map(
            (session) => `
              <div class="list-row">
                <strong>${escapeHtml(session.title)}</strong>
                <span>${escapeHtml(plainLanguageModeLabel(session.mode))}</span>
                <span title="${escapeHtml(formatExactIso(session.endsAt))}">Until ${escapeHtml(formatDateTime(session.endsAt))}</span>
                <span>${escapeHtml(session.channelScope.length > 0 ? session.channelScope.map((id) => selectedChannelNames.get(id) ?? id).join(', ') : 'All accessible channels')}</span>
                <button class="secondary stop-session" data-session-id="${escapeHtml(session.id)}">Stop</button>
              </div>
            `
          ),
          'No active sessions. Start watching before you go to sleep.'
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

  app.querySelector<HTMLFormElement>('#go-to-sleep-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);

    const mode = String(formData.get('mode') ?? 'manual_review');
    const endTimeVal = String(formData.get('endTime') ?? `${String(userStartHour).padStart(2, '0')}:00`);
    const endHour = Number(endTimeVal.split(':')[0]);
    const tz = String(formData.get('timezone') ?? userTz);

    try {
      await postJson<SessionCreateResponse>('/api/gateway/sessions', {
        ownerUserId: getCurrentUserId(),
        title: 'Watching overnight',
        mode,
        channelScope: selectedChannelIds,
        durationHours: calculateDurationHours(endHour, tz)
      });
      dashboardError = '';
      dashboardNotice = `Murph is now watching. You'll see drafts in Review.`;
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

  app.querySelector<HTMLFormElement>('#schedule-digest-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    await postJson('/api/gateway/recurring-jobs', {
      sessionId: String(formData.get('sessionId') ?? ''),
      channelId: String(formData.get('channelId') ?? ''),
      ownerUserId: getCurrentUserId(),
      localTime: String(formData.get('localTime') ?? '08:30'),
      timezone: String(formData.get('timezone') ?? userTz)
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
  setTitle('Murph Admin');
  loading('Admin');
  const [summary, setup, integrationsPayload] = await Promise.all([
    getJson<SummaryPayload>('/api/gateway/summary'),
    getJson<SetupStatusPayload>('/api/setup/status'),
    getJson<IntegrationStatusPayload>('/api/integrations/status')
  ]);

  shell(`
    <section class="page-head">
      <p class="eyebrow">Setup</p>
      <h1>Admin</h1>
      <p>Connect the services Murph needs to watch messages and draft useful replies.</p>
    </section>

    <dl class="kpis">
      ${metric('Workspace', summary.summary.workspace?.name ?? 'Not installed')}
      ${metric('AI provider', summary.summary.provider ? `${summary.summary.provider.provider} / ${summary.summary.provider.model}` : 'Not configured')}
      ${metric('Slack', setup.slack.installed ? 'Connected' : 'Not connected')}
      ${metric('Discord', setup.discord.installed ? 'Connected' : 'Not connected')}
    </dl>

    <section class="grid three">
      <article class="panel panel-status">
        <h2><span class="status-dot ${setup.slack.installed && setup.slack.oauthConfigured ? 'ok' : 'off'}" aria-hidden="true"></span>Slack</h2>
        <p>Let Murph watch Slack channels and prepare replies while you are away.</p>
        <dl class="details">
          <div><dt>Status</dt><dd>${setup.slack.installed ? 'Connected' : 'Not connected'}</dd></div>
          <div><dt>Setup</dt><dd>${setup.slack.oauthConfigured && setup.slack.signingSecretConfigured ? 'Ready to install' : 'Missing server settings'}</dd></div>
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
      <h2>Integrations</h2>
      <p class="empty">Connect optional sources Murph can use for more grounded replies.</p>
      <div class="grid two">
        ${integrationsPayload.integrations.map(integrationCard).join('')}
      </div>
    </section>
  `);

  const integrationsByProvider = new Map(integrationsPayload.integrations.map((integration) => [integration.provider, integration]));

  app.querySelectorAll<HTMLButtonElement>('.connect-integration').forEach((button) => {
    button.addEventListener('click', async () => {
      const provider = button.dataset.provider ?? '';
      const integration = integrationsByProvider.get(provider);
      const name = integration?.name ?? provider;
      const credential = window.prompt(`Enter your ${name} API key`);
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
      const name = integrationsByProvider.get(provider)?.name ?? provider;
      const response = await fetch(`/api/integrations/${encodeURIComponent(provider)}/disconnect?workspaceId=${encodeURIComponent(integrationsPayload.workspaceId)}`, {
        method: 'DELETE'
      });
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

    if (pathname === '/admin') {
      await renderSettings();
    } else if (pathname === '/review') {
      await renderReview();
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
