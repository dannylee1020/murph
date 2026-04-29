import { DEFAULT_PROVIDER_MODEL } from '#lib/config';
import { getDiscordService } from '#lib/server/channels/discord/service';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getStore } from '#lib/server/persistence/store';
import { redirect } from '../http.js';
import { route, type Route } from '../router.js';

export const discordRoutes: Route[] = [
  route('GET', '/api/discord/install', ({ res }) => {
    const url = getDiscordService().buildInstallUrl();
    redirect(res, url ?? '/settings?error=discord_not_configured');
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
      model: DEFAULT_PROVIDER_MODEL[env.defaultProvider]
    });

    redirect(res, '/settings?installed=discord');
  })
];
