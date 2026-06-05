import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { resolvePublicAppUrl } from '#shared/server/auth/dashboard-access';
import { getDiscordService } from '#shared/server/channels/discord/service';
import { ensureRuntimeInitialized } from '#shared/server/runtime/bootstrap';
import { refreshRuntimeState } from '#shared/server/runtime/refresh';
import { getChannelRegistry } from '#shared/server/capabilities/channel-registry';
import { getRuntimeEnv } from '#shared/server/util/env';
import { getStore } from '#shared/server/persistence/store';
import { openDiscordPersonalHandoff } from '#shared/server/channels/personal-handoff';
import { readBody, readJson, redirect, sendJson } from '../http.js';
import { route, type Route } from '../router.js';
import { pruneChannelRuntimeConfig } from '#shared/server/setup/config-file';
import { scheduleWithConfigFallback } from '#shared/server/setup/config-schedule';
import type { DiscordInstallResult } from '#shared/server/channels/discord/service';
import type { BotRole, SetupDefaults } from '#shared/types';

type OAuthSource = 'cli' | 'setup' | 'settings';

const DISCORD_ED25519_PUBLIC_KEY_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function publicAppUrl(req: IncomingMessage, url: URL): string {
  return resolvePublicAppUrl(req, url);
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

function verifyDiscordInteractionSignature(headers: IncomingMessage['headers'], rawBody: string, role: BotRole = 'channel'): boolean {
  const signature = firstHeaderValue(headers['x-signature-ed25519']);
  const timestamp = firstHeaderValue(headers['x-signature-timestamp']);
  const publicKey = getDiscordService().publicKey(role) ?? getRuntimeEnv().discordPublicKey;
  if (!signature || !timestamp || !publicKey) {
    return false;
  }
  try {
    const key = createPublicKey({
      key: Buffer.concat([DISCORD_ED25519_PUBLIC_KEY_PREFIX, Buffer.from(publicKey, 'hex')]),
      format: 'der',
      type: 'spki'
    });
    return verify(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(rawBody)]), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

function discordInteractionUserId(payload: Record<string, unknown>): string | undefined {
  const member = payload.member;
  if (member && typeof member === 'object') {
    const user = (member as { user?: unknown }).user;
    if (user && typeof user === 'object' && typeof (user as { id?: unknown }).id === 'string') {
      return (user as { id: string }).id;
    }
  }
  const user = payload.user;
  if (user && typeof user === 'object' && typeof (user as { id?: unknown }).id === 'string') {
    return (user as { id: string }).id;
  }
  return undefined;
}

function discordCommandOwnerUserId(payload: Record<string, unknown>): string | undefined {
  const data = payload.data;
  if (!data || typeof data !== 'object') return undefined;
  const targetId = (data as { target_id?: unknown }).target_id;
  if (typeof targetId === 'string') return targetId;
  const options = Array.isArray((data as { options?: unknown }).options)
    ? (data as { options: Array<{ name?: unknown; value?: unknown }> }).options
    : [];
  const owner = options.find((option) => option.name === 'owner');
  return typeof owner?.value === 'string' ? owner.value : undefined;
}

function discordInteractionResponse(text: string): Record<string, unknown> {
  return {
    type: 4,
    data: {
      content: text,
      flags: 64
    }
  };
}

function mergedSetupDefaults(): SetupDefaults {
  return getStore().getAppSettings().setupDefaults ?? {};
}

function saveAuthedDiscordUserAsWorkspaceOwner(result: DiscordInstallResult): void {
  if (!result.authedUser?.id) return;

  const store = getStore();
  const currentDefaults = mergedSetupDefaults();
  const schedule = scheduleWithConfigFallback(currentDefaults);
  const ownerDisplayName = result.authedUser.displayName || result.authedUser.id;
  const replacedPersonalWorkspaceIds = result.role === 'personal'
    ? new Set(store.listBotInstallations({ provider: 'discord', role: 'personal' }).map((installation) => installation.workspaceId))
    : new Set<string>();
  const nextOwners = [
    ...(currentDefaults.workspaceOwners ?? []).filter((owner) => (
      owner.workspaceId !== result.workspace.id &&
      !replacedPersonalWorkspaceIds.has(owner.workspaceId)
    )),
    {
      workspaceId: result.workspace.id,
      ownerUserId: result.authedUser.id,
      ownerDisplayName
    }
  ];

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
      provider: 'discord',
      status: 'active',
      channelScopeMode,
      channelScope: channelScopeMode === 'selected' ? configuredChannelScope : []
    });
  }
  store.upsertAppSettings({
    ...store.getAppSettings(),
    setupDefaults: {
      ...currentDefaults,
      botRoles: [result.role],
      providerBotRoles: {
        ...(currentDefaults.providerBotRoles ?? {}),
        discord: [result.role]
      },
      workspaceOwners: nextOwners,
      ...(currentDefaults.ownerUserId?.trim() && result.role !== 'personal'
        ? {}
        : {
            ownerUserId: result.authedUser.id,
            ownerDisplayName
          }),
      ...(currentDefaults.workspaceId?.trim() && result.role !== 'personal'
        ? {}
        : {
            workspaceId: result.workspace.id,
            channelProvider: 'discord'
          })
    }
  });
  pruneChannelRuntimeConfig();
}

export const discordRoutes: Route[] = [
  route('POST', '/api/discord/interactions', async ({ req, res }) => {
    const rawBody = await readBody(req);
    if (!verifyDiscordInteractionSignature(req.headers, rawBody, 'channel') && !verifyDiscordInteractionSignature(req.headers, rawBody, 'personal')) {
      sendJson(res, { error: 'invalid_signature' }, 401);
      return;
    }

    const payload = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
    if (payload.type === 1) {
      sendJson(res, { type: 1 });
      return;
    }

    const senderUserId = discordInteractionUserId(payload);
    if (!senderUserId) {
      sendJson(res, discordInteractionResponse('Murph could not identify the Discord user.'));
      return;
    }

    const result = await openDiscordPersonalHandoff({
      senderUserId,
      ownerUserId: discordCommandOwnerUserId(payload)
    });
    sendJson(res, discordInteractionResponse(result.message));
  }),
  route('GET', '/api/discord/install', ({ req, res, url: requestUrl }) => {
    const role = parseBotRole(requestUrl.searchParams.get('role'));
    const source = parseOAuthSource(requestUrl.searchParams.get('source'));
    if (role === 'personal') {
      redirect(res, source === 'cli'
        ? discordCliReturnPath(role, 'error', 'personal_runtime_unsupported')
        : discordReturnPath(source, '?error=personal_runtime_unsupported'));
      return;
    }
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
    if (role === 'personal') {
      redirect(res, source === 'cli'
        ? discordCliReturnPath(role, 'error', 'personal_runtime_unsupported')
        : discordReturnPath(source, '?error=personal_runtime_unsupported'));
      return;
    }
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

    if (role === 'personal') {
      redirect(res, source === 'cli'
        ? discordCliReturnPath(role, 'error', 'personal_runtime_unsupported')
        : discordReturnPath(source, '?error=personal_runtime_unsupported'));
      return;
    }

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
      const redirectUri = process.env.DISCORD_REDIRECT_URI ?? `${publicAppUrl(req, url)}/api/discord/oauth/callback`;
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
