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
import type { BotRole, SetupDefaults } from '#lib/types';

type OAuthSource = 'cli' | 'setup' | 'settings';

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

function parseBotRole(value: string | null | undefined): BotRole {
  return value === 'personal' ? 'personal' : 'channel';
}

function parseOAuthSource(value: string | null | undefined): OAuthSource {
  return value === 'cli' || value === 'setup' ? value : 'settings';
}

function encodeDiscordState(source: OAuthSource = 'settings', role: BotRole = 'channel'): string {
  const body = Buffer.from(JSON.stringify({ source, role, ts: Date.now() }), 'utf8').toString('base64url');
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

function discordStateSource(state: string | null): OAuthSource {
  if (!state) return 'settings';
  const [body] = state.split('.');
  if (!body) return 'settings';
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { source?: string };
    return parseOAuthSource(parsed.source);
  } catch {
    return 'settings';
  }
}

function discordStateRole(state: string | null): BotRole {
  if (!state) return 'channel';
  const [body] = state.split('.');
  if (!body) return 'channel';
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { role?: string };
    return parseBotRole(parsed.role);
  } catch {
    return 'channel';
  }
}

function discordReturnPath(source: OAuthSource, query: string): string {
  return source === 'setup' ? `/setup${query}` : `/settings${query}`;
}

function discordCliReturnPath(role: BotRole, status: 'success' | 'error', reason?: string): string {
  const params = new URLSearchParams({
    provider: 'discord',
    role,
    status
  });
  if (reason) params.set('reason', reason);
  return `/oauth/cli-complete?${params.toString()}`;
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
  if (result.role === 'channel') {
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
    const role = parseBotRole(requestUrl.searchParams.get('role'));
    const source = parseOAuthSource(requestUrl.searchParams.get('source'));
    if (!getDiscordService().isRoleConfigured(role)) {
      redirect(res, source === 'cli'
        ? discordCliReturnPath(role, 'error', 'discord_client_secret_required')
        : discordReturnPath(source, '?error=discord_client_secret_required'));
      return;
    }
    const url = getDiscordService().buildInstallUrl({
      appUrl: publicAppUrl(req, requestUrl),
      source: encodeDiscordState(source, role),
      role
    });
    redirect(res, url ?? (source === 'cli'
      ? discordCliReturnPath(role, 'error', 'discord_not_configured')
      : discordReturnPath(source, '?error=discord_not_configured')));
  }),
  route('GET', '/api/discord/:botRole/install', ({ req, res, url: requestUrl, params }) => {
    const role = parseBotRole(params.botRole);
    const source = parseOAuthSource(requestUrl.searchParams.get('source'));
    if (!getDiscordService().isRoleConfigured(role)) {
      redirect(res, source === 'cli'
        ? discordCliReturnPath(role, 'error', 'discord_client_secret_required')
        : discordReturnPath(source, '?error=discord_client_secret_required'));
      return;
    }
    const url = getDiscordService().buildInstallUrl({
      appUrl: publicAppUrl(req, requestUrl),
      source: encodeDiscordState(source, role),
      role
    });
    redirect(res, url ?? (source === 'cli'
      ? discordCliReturnPath(role, 'error', 'discord_not_configured')
      : discordReturnPath(source, '?error=discord_not_configured')));
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
    const role = discordStateRole(state);

    if (!code) {
      redirect(res, source === 'cli'
        ? discordCliReturnPath(role, 'error', 'missing_code')
        : discordReturnPath(source, '?error=missing_code'));
      return;
    }
    if (!verifyDiscordState(state)) {
      redirect(res, source === 'cli'
        ? discordCliReturnPath(role, 'error', 'invalid_state')
        : discordReturnPath(source, '?error=discord_oauth_failed&reason=invalid_state'));
      return;
    }

    try {
      await ensureRuntimeInitialized();
      const env = getRuntimeEnv();
      const redirectUri = env.discordRedirectUri ?? `${publicAppUrl(req, url)}/api/discord/oauth/callback`;
      const install = await getDiscordService().exchangeCode(code, guildId, redirectUri, role);
      const { workspace } = install;
      saveAuthedDiscordUserAsWorkspaceOwner(install);
      await getChannelRegistry().getIngress('discord')?.start?.({ provider: 'discord' });
      await refreshRuntimeState({
        reason: 'channel_setup_updated',
        workspaceIds: [workspace.id],
        deferIfRunActive: true
      });

      redirect(res, source === 'cli'
        ? discordCliReturnPath(role, 'success')
        : source === 'setup'
          ? `/setup?step=discord&role=${encodeURIComponent(role)}&success=1&workspaceId=${encodeURIComponent(workspace.id)}`
          : `/settings?installed=discord&workspaceId=${encodeURIComponent(workspace.id)}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'discord_oauth_failed';
      redirect(res, source === 'cli'
        ? discordCliReturnPath(role, 'error', reason)
        : discordReturnPath(source, `?step=discord&role=${encodeURIComponent(role)}&error=discord_oauth_failed&reason=${encodeURIComponent(reason)}`));
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
      const workspace = await getDiscordService().saveGuildWorkspace(guild, 'channel');
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
