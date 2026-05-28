import { readSecret } from '#shared/server/credentials/local-store';
import { getStore } from '#shared/server/persistence/store';
import { providerBotRoleEnabled } from '#shared/server/setup/bot-roles';
import { readMurphConfig } from '#shared/server/setup/config-file';
import { getRuntimeEnv } from '#shared/server/util/env';
import type { ChannelPlugin } from '#shared/types';
import { createDiscordChannelAdapter } from './adapter.js';
import { getDiscordGatewayClient } from './gateway-client.js';
import { getDiscordService } from './service.js';

export function createDiscordChannelPlugin(): ChannelPlugin {
  const discord = getDiscordService();

  return {
    id: 'discord',
    displayName: 'Discord',
    description: 'Discord channel plugin',
    runtime: createDiscordChannelAdapter(),
    setup: {
      requirements: [
        { key: 'DISCORD_BOT_TOKEN', label: 'Bot token', kind: 'secret', required: true },
        { key: 'DISCORD_CLIENT_ID', label: 'Application client ID', kind: 'config', required: true },
        { key: 'DISCORD_CLIENT_SECRET', label: 'Application client secret', kind: 'secret', required: false },
        { key: 'DISCORD_REDIRECT_URI', label: 'OAuth redirect URI', kind: 'config', required: false },
        {
          key: 'discord_privileged_intents',
          label: 'Message Content intent',
          kind: 'manual',
          required: true
        }
      ],
      getStatus() {
        const env = getRuntimeEnv();
        const workspace = getStore().listWorkspaces().find((entry) => (
          entry.provider === 'discord' &&
          (Boolean(env.discordBotToken) || Boolean(readSecret('discord', 'bot_token', {
            workspaceId: entry.id,
            externalWorkspaceId: entry.externalWorkspaceId
          })))
        ));
        return {
          configured: Boolean(env.discordBotToken || readSecret('discord', 'bot_token')),
          installed: Boolean(workspace),
          workspace: workspace
            ? {
                id: workspace.id,
                externalWorkspaceId: workspace.externalWorkspaceId,
                name: workspace.name
              }
            : undefined
        };
      },
      getMember(workspace, userId) {
        return discord.getMember(workspace, userId);
      },
      listChannels(workspace) {
        return discord.listChannels(workspace);
      },
      getChannel(workspace, channelId) {
        return discord.getChannel(workspace, channelId);
      }
    },
    ingress: {
      start() {
        const setupDefaults = readMurphConfig().setup;
        if (providerBotRoleEnabled(setupDefaults, 'discord', 'channel')) {
          getDiscordGatewayClient('channel').ensureStarted();
        }
        if (providerBotRoleEnabled(setupDefaults, 'discord', 'personal')) {
          getDiscordGatewayClient('personal').ensureStarted();
        }
      }
    }
  };
}
