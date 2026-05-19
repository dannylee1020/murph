import { readSecret } from '#lib/server/credentials/local-store';
import { getStore } from '#lib/server/persistence/store';
import { getRuntimeEnv } from '#lib/server/util/env';
import type { ChannelPlugin } from '#lib/types';
import { createDiscordChannelAdapter } from './adapter.js';
import { getDiscordGatewayClient } from './gateway-client.js';
import { getDiscordService } from './service.js';

export function createDiscordChannelPlugin(): ChannelPlugin {
  const discord = getDiscordService();

  return {
    id: 'discord',
    displayName: 'Discord',
    description: 'Discord channel plugin',
    adapter: createDiscordChannelAdapter(),
    connector: {
      requirements: [
        { key: 'DISCORD_BOT_TOKEN', label: 'Bot token', kind: 'secret', required: true },
        { key: 'DISCORD_CLIENT_ID', label: 'Application client ID', kind: 'config', required: true },
        { key: 'DISCORD_CLIENT_SECRET', label: 'Application client secret', kind: 'secret', required: false },
        { key: 'DISCORD_REDIRECT_URI', label: 'OAuth redirect URI', kind: 'config', required: false },
        {
          key: 'discord_privileged_intents',
          label: 'Server Members and Message Content intents',
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
      listMembers(workspace) {
        return discord.listMembers(workspace);
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
        getDiscordGatewayClient().ensureStarted();
      }
    }
  };
}
