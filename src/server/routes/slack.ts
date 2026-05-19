import { getRuntimeEnv } from '#lib/server/util/env';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import { handleSlackEventEnvelope, verifySlackHttpSignature } from '#lib/server/channels/slack/events';
import { getSlackService } from '#lib/server/channels/slack/service';
import { getSlackSocketModeClient } from '#lib/server/channels/slack/socket-client';
import { getStore } from '#lib/server/persistence/store';
import { readMurphConfig, updateMurphSetupDefaults } from '#lib/server/setup/config-file';
import { readBody, redirect, sendJson, toHeaders } from '../http.js';
import { route, type Route } from '../router.js';
import type { SlackInstallResult } from '#lib/server/channels/slack/service';

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

function saveAuthedUserAsDefaultOwner(result: SlackInstallResult): void {
  if (!result.authedUser?.id) return;

  const store = getStore();
  const currentDefaults = {
    ...(store.getAppSettings().setupDefaults ?? {}),
    ...(readMurphConfig().setup ?? {})
  };
  if (currentDefaults.ownerUserId?.trim()) return;

  store.upsertUser({
    workspaceId: result.workspace.id,
    externalUserId: result.authedUser.id,
    displayName: result.authedUser.displayName || result.authedUser.id,
    timezone: currentDefaults.timezone,
    workdayStartHour: currentDefaults.workdayStartHour,
    workdayEndHour: currentDefaults.workdayEndHour
  });
  updateMurphSetupDefaults({
    ...currentDefaults,
    ownerUserId: result.authedUser.id,
    ownerDisplayName: result.authedUser.displayName || result.authedUser.id
  });
}

export const slackRoutes: Route[] = [
  route('POST', '/api/slack/events', async ({ req, res }) => {
    await ensureRuntimeInitialized();
    const rawBody = await readBody(req);

    if (!verifySlackHttpSignature(toHeaders(req), rawBody)) {
      console.warn('[slack] rejected event: invalid_signature');
      sendJson(res, { ok: false, error: 'invalid_signature' }, 401);
      return;
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;

    if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
      sendJson(res, { challenge: payload.challenge });
      return;
    }

    const result = await handleSlackEventEnvelope(payload, { rawPayload: rawBody, source: 'http' });
    sendJson(res, result);
  }),
  route('GET', '/api/slack/install', ({ req, res, url: requestUrl }) => {
    const url = getSlackService().buildInstallUrl(
      publicAppUrl(req, requestUrl),
      requestUrl.searchParams.get('team') ?? undefined,
      requestUrl.searchParams.get('source') ?? undefined
    );
    redirect(res, url ?? '/settings?error=slack_not_configured');
  }),
  route('GET', '/api/slack/oauth/callback', async ({ req, res, url }) => {
    const code = url.searchParams.get('code');
    const source = url.searchParams.get('state');
    const sourceSuffix = source === 'cli' ? '&source=cli' : '';

    if (!code) {
      redirect(res, '/settings?error=missing_code');
      return;
    }

    try {
      const install = await getSlackService().exchangeCode(code, publicAppUrl(req, url));
      const { workspace } = install;
      const env = getRuntimeEnv();

      getStore().upsertProviderSettings({
        workspaceId: workspace.id,
        provider: env.defaultProvider,
        model: env.defaultModel
      });
      saveAuthedUserAsDefaultOwner(install);
      getSlackSocketModeClient().ensureStarted();

      redirect(res, `/setup?step=slack&success=1${sourceSuffix}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'slack_oauth_failed';
      redirect(res, `/setup?step=slack&error=slack_oauth_failed&reason=${encodeURIComponent(reason)}${sourceSuffix}`);
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

    try {
      const members = await getSlackService().listMembers(workspace);
      sendJson(res, { ok: true, members });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'Failed to list members', members: [] }, 500);
    }
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
