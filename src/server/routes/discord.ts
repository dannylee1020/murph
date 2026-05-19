import { getDiscordService } from '#lib/server/channels/discord/service';
import { getDiscordGatewayClient } from '#lib/server/channels/discord/gateway-client';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getStore } from '#lib/server/persistence/store';
import { readJson, redirect, sendJson } from '../http.js';
import { route, type Route } from '../router.js';

export const discordRoutes: Route[] = [
  route('GET', '/api/discord/install', ({ res }) => {
    const url = getDiscordService().buildInstallUrl();
    redirect(res, url ?? '/settings?error=discord_not_configured');
  }),
  route('GET', '/api/discord/guilds', async ({ res }) => {
    try {
      sendJson(res, { ok: true, guilds: await getDiscordService().listCurrentGuilds() });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'discord_guild_list_failed' }, 400);
    }
  }),
  route('GET', '/api/discord/oauth/callback', async ({ res, url }) => {
    const code = url.searchParams.get('code');
    const guildId = url.searchParams.get('guild_id') ?? undefined;

    if (!code) {
      redirect(res, '/settings?error=missing_code');
      return;
    }

    const workspace = await getDiscordService().exchangeCode(code, guildId);
    const env = getRuntimeEnv();
    getStore().upsertProviderSettings({
      workspaceId: workspace.id,
      provider: env.defaultProvider,
      model: env.defaultModel
    });
    getDiscordGatewayClient().ensureStarted();

    redirect(res, '/settings?installed=discord');
  }),
  route('POST', '/api/discord/guild', async ({ req, res }) => {
    const body = await readJson<{ guildId?: string }>(req);
    const guildId = body.guildId?.trim();
    if (!guildId) {
      sendJson(res, { ok: false, error: 'guild_id_required' }, 400);
      return;
    }

    try {
      const guild = await getDiscordService().fetchGuild(guildId);
      const workspace = await getDiscordService().saveGuildWorkspace(guild);
      const env = getRuntimeEnv();
      getStore().upsertProviderSettings({
        workspaceId: workspace.id,
        provider: env.defaultProvider,
        model: env.defaultModel
      });
      getDiscordGatewayClient().ensureStarted();
      sendJson(res, {
        ok: true,
        workspace: {
          id: workspace.id,
          externalWorkspaceId: workspace.externalWorkspaceId,
          name: workspace.name
        }
      });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'discord_guild_save_failed' }, 400);
    }
  })
];
