import { ensureRuntimeInitialized } from '#shared/server/runtime/bootstrap';
import { refreshRuntimeState } from '#shared/server/runtime/refresh';
import { handleSlackEventEnvelope, verifySlackHttpSignature } from '#shared/server/channels/slack/events';
import { getSlackService } from '#shared/server/channels/slack/service';
import { getChannelRegistry } from '#shared/server/capabilities/channel-registry';
import { getStore } from '#shared/server/persistence/store';
import { handleSlackInteractionPayload, parseSlackInteractionPayload } from '#shared/server/channels/slack/interactions';
import { pruneChannelRuntimeConfig } from '#shared/server/setup/config-file';
import { scheduleWithConfigFallback } from '#shared/server/setup/config-schedule';
import { readBody, redirect, sendJson, toHeaders } from '../http.js';
import { route, type Route } from '../router.js';
import type { SlackInstallResult } from '#shared/server/channels/slack/service';
import type { BotRole } from '#shared/types';

type OAuthSource = 'cli' | 'setup' | 'settings';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function publicAppUrl(req: Parameters<typeof toHeaders>[0], url: URL): string {
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const host = forwardedHost ?? req.headers.host ?? url.host;
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const proto = forwardedProto ?? (host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function getSlackWorkspace() {
  return getSlackService().getUsableWorkspace();
}

function parseBotRole(value: string | null | undefined): BotRole {
  return value === 'personal' ? 'personal' : 'channel';
}

function parseOAuthSource(value: string | null | undefined): OAuthSource {
  return value === 'cli' || value === 'setup' ? value : 'settings';
}

function parseSlackState(state: string | null): { role: BotRole; source: OAuthSource } {
  if (state?.startsWith('personal:')) {
    return { role: 'personal', source: parseOAuthSource(state.slice('personal:'.length)) };
  }
  return { role: 'channel', source: parseOAuthSource(state) };
}

function slackReturnPath(source: OAuthSource, role: BotRole, status: 'success' | 'error', reason?: string): string {
  if (source === 'cli') {
    const params = new URLSearchParams({
      provider: 'slack',
      role,
      status
    });
    if (reason) params.set('reason', reason);
    return `/oauth/cli-complete?${params.toString()}`;
  }
  if (source === 'setup') {
    const params = new URLSearchParams({
      step: 'slack',
      role,
      ...(status === 'success'
        ? { success: '1' }
        : { error: 'slack_oauth_failed', reason: reason ?? 'slack_oauth_failed' })
    });
    return `/setup?${params.toString()}`;
  }
  const params = new URLSearchParams(
    status === 'success'
      ? { installed: 'slack' }
      : { error: 'slack_oauth_failed', reason: reason ?? 'slack_oauth_failed' }
  );
  return `/settings?${params.toString()}`;
}

function saveAuthedUserAsSetupOwner(result: SlackInstallResult): void {
  if (!result.authedUser?.id) return;

  const store = getStore();
  const currentDefaults = store.getAppSettings().setupDefaults ?? {};
  const schedule = scheduleWithConfigFallback(currentDefaults);
  const ownerDisplayName = result.authedUser.displayName || result.authedUser.id;

  const user = store.upsertUser({
    workspaceId: result.workspace.id,
    externalUserId: result.authedUser.id,
    displayName: ownerDisplayName,
    timezone: schedule.timezone,
    workdayStartHour: schedule.workdayStartHour,
    workdayEndHour: schedule.workdayEndHour
  });
  if (result.role === 'channel') {
    const workspaceChannelDefaults = currentDefaults.workspaceChannels?.find(
      (entry) => entry.workspaceId === result.workspace.id
    );
    const configuredChannelScope =
      workspaceChannelDefaults?.selectedChannels.map((channel) => channel.id) ??
      currentDefaults.selectedChannels?.map((channel) => channel.id) ??
      [];
    const configuredChannelScopeMode =
      workspaceChannelDefaults?.channelScopeMode ?? currentDefaults.channelScopeMode ?? 'all_accessible';
    const channelScopeMode =
      configuredChannelScopeMode === 'selected' && configuredChannelScope.length === 0
        ? 'all_accessible'
        : configuredChannelScopeMode;
    store.ensureWorkspaceSubscriptionForUser(user, {
      provider: 'slack',
      status: 'active',
      channelScopeMode,
      channelScope: channelScopeMode === 'selected' ? configuredChannelScope : []
    });
  }

  const workspaceOwners = [
    ...(currentDefaults.workspaceOwners ?? []).filter((owner) => owner.workspaceId !== result.workspace.id),
    {
      workspaceId: result.workspace.id,
      ownerUserId: result.authedUser.id,
      ownerDisplayName
    }
  ];

  store.upsertAppSettings({
    ...store.getAppSettings(),
    setupDefaults: {
      ...currentDefaults,
      botRoles: [result.role],
      providerBotRoles: {
        ...(currentDefaults.providerBotRoles ?? {}),
        slack: [result.role]
      },
      workspaceOwners,
      ...(currentDefaults.ownerUserId?.trim()
        ? {}
        : {
            ownerUserId: result.authedUser.id,
            ownerDisplayName
          })
    }
  });
  pruneChannelRuntimeConfig();
}

export const slackRoutes: Route[] = [
  route('POST', '/api/slack/interactions', async ({ req, res }) => {
    const rawBody = await readBody(req);
    if (!verifySlackHttpSignature(toHeaders(req), rawBody, 'channel')) {
      console.warn('[slack] rejected interaction: invalid_signature');
      sendJson(res, { response_type: 'ephemeral', text: 'Murph could not verify this Slack request.' }, 401);
      return;
    }

    const result = await handleSlackInteractionPayload(parseSlackInteractionPayload(rawBody));
    sendJson(res, result);
  }),
  route('POST', '/api/slack/events', async ({ req, res }) => {
    await ensureRuntimeInitialized();
    const rawBody = await readBody(req);

    if (!verifySlackHttpSignature(toHeaders(req), rawBody, 'channel')) {
      console.warn('[slack] rejected event: invalid_signature');
      sendJson(res, { ok: false, error: 'invalid_signature' }, 401);
      return;
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;

    if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
      sendJson(res, { challenge: payload.challenge });
      return;
    }

    const result = await handleSlackEventEnvelope(payload, { rawPayload: rawBody, source: 'http', botRole: 'channel' });
    sendJson(res, result);
  }),
  route('POST', '/api/slack/:botRole/events', async ({ req, res, params }) => {
    await ensureRuntimeInitialized();
    const botRole = parseBotRole(params.botRole);
    const rawBody = await readBody(req);

    if (!verifySlackHttpSignature(toHeaders(req), rawBody, botRole)) {
      console.warn('[slack] rejected event: invalid_signature');
      sendJson(res, { ok: false, error: 'invalid_signature' }, 401);
      return;
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;

    if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
      sendJson(res, { challenge: payload.challenge });
      return;
    }

    const result = await handleSlackEventEnvelope(payload, { rawPayload: rawBody, source: 'http', botRole });
    sendJson(res, result);
  }),
  route('GET', '/api/slack/install', ({ req, res, url: requestUrl }) => {
    const role = parseBotRole(requestUrl.searchParams.get('role'));
    const url = getSlackService().buildInstallUrl(
      publicAppUrl(req, requestUrl),
      requestUrl.searchParams.get('team') ?? undefined,
      requestUrl.searchParams.get('source') ?? undefined,
      role
    );
    redirect(res, url ?? '/settings?error=slack_not_configured');
  }),
  route('GET', '/api/slack/:botRole/install', ({ req, res, url: requestUrl, params }) => {
    const role = parseBotRole(params.botRole);
    const url = getSlackService().buildInstallUrl(
      publicAppUrl(req, requestUrl),
      requestUrl.searchParams.get('team') ?? undefined,
      requestUrl.searchParams.get('source') ?? undefined,
      role
    );
    redirect(res, url ?? '/settings?error=slack_not_configured');
  }),
  route('GET', '/api/slack/oauth/callback', async ({ req, res, url }) => {
    const code = url.searchParams.get('code');
    const state = parseSlackState(url.searchParams.get('state'));
    const source = state.source;

    if (!code) {
      redirect(res, slackReturnPath(source, state.role, 'error', 'missing_code'));
      return;
    }

    try {
      await ensureRuntimeInitialized();
      const install = await getSlackService().exchangeCode(code, publicAppUrl(req, url), state.role);
      const { workspace } = install;
      saveAuthedUserAsSetupOwner(install);
      await getChannelRegistry().getIngress('slack')?.start?.({ provider: 'slack' });
      await refreshRuntimeState({
        reason: 'channel_setup_updated',
        workspaceIds: [workspace.id],
        deferIfRunActive: true
      });

      redirect(res, slackReturnPath(source, state.role, 'success'));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'slack_oauth_failed';
      redirect(res, slackReturnPath(source, state.role, 'error', reason));
    }
  }),
  route('GET', '/api/slack/members', async ({ res }) => {
    const workspace = getSlackWorkspace();

    if (!workspace) {
      sendJson(res, {
        ok: false,
        error: getSlackService().hasUnreadableInstall() ? 'slack_reconnect_required' : 'no_workspace',
        members: []
      }, 400);
      return;
    }

    sendJson(res, { ok: false, error: 'owner_identity_locked', members: [] }, 410);
  }),
  route('GET', '/api/slack/channels', async ({ res }) => {
    const workspace = getSlackWorkspace();

    if (!workspace) {
      sendJson(res, {
        ok: false,
        error: getSlackService().hasUnreadableInstall() ? 'slack_reconnect_required' : 'no_workspace',
        channels: []
      }, 400);
      return;
    }

    try {
      const channels = await getSlackService().listChannels(workspace);
      sendJson(res, { ok: true, channels });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'Failed to list Slack channels', channels: [] }, 500);
    }
  })
];
