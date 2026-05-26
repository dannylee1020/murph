import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { getDiscordService } from '#lib/server/channels/discord/service';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import { refreshRuntimeState } from '#lib/server/runtime/refresh';
import { getChannelRegistry } from '#lib/server/capabilities/channel-registry';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getStore } from '#lib/server/persistence/store';
import { readJson, redirect, sendJson } from '../http.js';
import { route, type Route } from '../router.js';
import { readMurphConfig, updateMurphSetupDefaults } from '#lib/server/setup/config-file';
import type { DiscordInstallResult } from '#lib/server/channels/discord/service';
import type { SetupDefaults } from '#lib/types';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function publicAppUrl(req: IncomingMessage, url: URL): string {
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const host = forwardedHost ?? req.headers.host ?? url.host;
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const proto = forwardedProto ?? (host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function discordStateSecret(): string {
  const env = getRuntimeEnv();
  return env.encryptionKey || env.discordClientSecret || 'murph-local-discord-oauth';
}

function signStateBody(body: string): string {
  return createHmac('sha256', discordStateSecret()).update(body).digest('base64url');
}

function encodeDiscordState(source = 'settings'): string {
  const body = Buffer.from(JSON.stringify({ source, ts: Date.now() }), 'utf8').toString('base64url');
  return `${body}.${signStateBody(body)}`;
}

function verifyDiscordState(state: string | null): boolean {
  if (!state) return true;
  const [body, signature] = state.split('.');
  if (!body || !signature) return false;
  const expected = signStateBody(body);
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function discordStateSource(state: string | null): 'settings' | 'setup' {
  if (!state) return 'settings';
  const [body] = state.split('.');
  if (!body) return 'settings';
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { source?: string };
    return parsed.source === 'setup' ? 'setup' : 'settings';
  } catch {
    return 'settings';
  }
}

function discordReturnPath(source: 'settings' | 'setup', query: string): string {
  return source === 'setup' ? `/setup${query}` : `/settings${query}`;
}

function mergedSetupDefaults(): SetupDefaults {
  const store = getStore();
  return {
    ...(store.getAppSettings().setupDefaults ?? {}),
    ...(readMurphConfig().setup ?? {})
  };
}

function saveAuthedDiscordUserAsWorkspaceOwner(result: DiscordInstallResult): void {
  if (!result.authedUser?.id) return;

  const store = getStore();
  const currentDefaults = mergedSetupDefaults();
  const nextOwners = [
    ...(currentDefaults.workspaceOwners ?? []).filter((owner) => owner.workspaceId !== result.workspace.id),
    {
      workspaceId: result.workspace.id,
      ownerUserId: result.authedUser.id,
      ownerDisplayName: result.authedUser.displayName || result.authedUser.id
    }
  ];

  const user = store.upsertUser({
    workspaceId: result.workspace.id,
    externalUserId: result.authedUser.id,
    displayName: result.authedUser.displayName || result.authedUser.id,
    timezone: currentDefaults.timezone,
    workdayStartHour: currentDefaults.workdayStartHour,
    workdayEndHour: currentDefaults.workdayEndHour
  });
  if (getRuntimeEnv().productMode === 'channel') {
    const workspaceChannelDefaults = currentDefaults.workspaceChannels?.find(
      (entry) => entry.workspaceId === result.workspace.id
    );
    store.ensureWorkspaceSubscriptionForUser(user, {
      provider: 'discord',
      status: 'active',
      channelScopeMode:
        workspaceChannelDefaults?.channelScopeMode ?? currentDefaults.channelScopeMode ?? 'all_accessible',
      channelScope:
        workspaceChannelDefaults?.selectedChannels.map((channel) => channel.id) ??
        currentDefaults.selectedChannels?.map((channel) => channel.id) ??
        []
    });
  }
  updateMurphSetupDefaults({
    ...currentDefaults,
    workspaceOwners: nextOwners
  });
}

export const discordRoutes: Route[] = [
  route('GET', '/api/discord/install', ({ req, res, url: requestUrl }) => {
    const env = getRuntimeEnv();
    const source = requestUrl.searchParams.get('source') === 'setup' ? 'setup' : 'settings';
    if (!env.discordClientSecret) {
      redirect(res, discordReturnPath(source, '?error=discord_client_secret_required'));
      return;
    }
    const url = getDiscordService().buildInstallUrl({
      appUrl: publicAppUrl(req, requestUrl),
      source: encodeDiscordState(source)
    });
    redirect(res, url ?? discordReturnPath(source, '?error=discord_not_configured'));
  }),
  route('GET', '/api/discord/guilds', async ({ res }) => {
    try {
      sendJson(res, { ok: true, guilds: await getDiscordService().listCurrentGuilds() });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'discord_guild_list_failed' }, 400);
    }
  }),
  route('GET', '/api/discord/oauth/callback', async ({ req, res, url }) => {
    const code = url.searchParams.get('code');
    const guildId = url.searchParams.get('guild_id') ?? undefined;
    const state = url.searchParams.get('state');
    const source = discordStateSource(state);

    if (!code) {
      redirect(res, discordReturnPath(source, '?error=missing_code'));
      return;
    }
    if (!verifyDiscordState(state)) {
      redirect(res, discordReturnPath(source, '?error=discord_oauth_failed&reason=invalid_state'));
      return;
    }

    try {
      await ensureRuntimeInitialized();
      const env = getRuntimeEnv();
      const redirectUri = env.discordRedirectUri ?? `${publicAppUrl(req, url)}/api/discord/oauth/callback`;
      const install = await getDiscordService().exchangeCode(code, guildId, redirectUri);
      const { workspace } = install;
      saveAuthedDiscordUserAsWorkspaceOwner(install);
      await getChannelRegistry().getIngress('discord')?.start?.({ provider: 'discord' });
      await refreshRuntimeState({
        reason: 'channel_setup_updated',
        workspaceIds: [workspace.id],
        deferIfRunActive: true
      });

      redirect(res, source === 'setup'
        ? `/setup?step=discord&success=1&workspaceId=${encodeURIComponent(workspace.id)}`
        : `/settings?installed=discord&workspaceId=${encodeURIComponent(workspace.id)}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'discord_oauth_failed';
      redirect(res, discordReturnPath(source, `?step=discord&error=discord_oauth_failed&reason=${encodeURIComponent(reason)}`));
    }
  }),
  route('POST', '/api/discord/guild', async ({ req, res }) => {
    const body = await readJson<{ guildId?: string }>(req);
    const guildId = body.guildId?.trim();
    if (!guildId) {
      sendJson(res, { ok: false, error: 'guild_id_required' }, 400);
      return;
    }

    try {
      await ensureRuntimeInitialized();
      const guild = await getDiscordService().fetchGuild(guildId);
      const workspace = await getDiscordService().saveGuildWorkspace(guild);
      await getChannelRegistry().getIngress('discord')?.start?.({ provider: 'discord' });
      const refresh = await refreshRuntimeState({
        reason: 'channel_setup_updated',
        workspaceIds: [workspace.id],
        deferIfRunActive: true
      });
      sendJson(res, {
        ok: true,
        workspace: {
          id: workspace.id,
          externalWorkspaceId: workspace.externalWorkspaceId,
          name: workspace.name
        },
        refresh
      });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'discord_guild_save_failed' }, 400);
    }
  })
];
