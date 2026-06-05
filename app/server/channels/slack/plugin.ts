import { getStore } from '#app/server/persistence/store';
import { providerBotRoleEnabled } from '#app/server/setup/bot-roles';
import type { ChannelPlugin } from '#app/types';
import { createSlackChannelAdapter } from './adapter.js';
import { handleSlackEventEnvelope, verifySlackHttpSignature } from './events.js';
import { getSlackService } from './service.js';
import { getSlackSocketModeClient } from './socket-client.js';

export function createSlackChannelPlugin(): ChannelPlugin {
  const slack = getSlackService();

  return {
    id: 'slack',
    displayName: 'Slack',
    description: 'Slack channel plugin',
    runtime: createSlackChannelAdapter(),
    setup: {
      requirements: [
        { key: 'SLACK_CLIENT_ID', label: 'Client ID', kind: 'config', required: true },
        { key: 'SLACK_CLIENT_SECRET', label: 'Client secret', kind: 'secret', required: true },
        { key: 'SLACK_SIGNING_SECRET', label: 'Signing secret', kind: 'secret', required: true },
        { key: 'SLACK_APP_TOKEN', label: 'App-level token', kind: 'secret', required: false }
      ],
      getStatus() {
        const workspace = slack.getUsableWorkspace();
        return {
          configured: slack.isRoleConfigured('channel') || slack.isRoleConfigured('personal'),
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
        return slack.getMember(workspace, userId);
      },
      listChannels(workspace) {
        return slack.listChannels(workspace);
      },
      async getChannel(workspace, channelId) {
        const channel = await slack.getChannelInfo(workspace, channelId);
        return {
          id: channel.id,
          displayName: channel.name ? `#${channel.name}` : channel.id,
          name: channel.name,
          isPrivate: channel.isPrivate,
          isMember: channel.isMember
        };
      }
    },
    ingress: {
      start() {
        if (slack.getUsableWorkspace()) {
          const setupDefaults = getStore().getAppSettings().setupDefaults;
          const channelClient = getSlackSocketModeClient('channel');
          const personalClient = getSlackSocketModeClient('personal');
          if (providerBotRoleEnabled(setupDefaults, 'slack', 'channel') && channelClient.isConfigured()) {
            channelClient.ensureStarted();
          }
          if (providerBotRoleEnabled(setupDefaults, 'slack', 'personal') && personalClient.isConfigured()) {
            personalClient.ensureStarted();
          }
        }
      },
      async handleWebhook({ rawBody, headers }) {
        if (!verifySlackHttpSignature(headers, rawBody)) {
          return { ok: false, error: 'invalid_signature' };
        }
        const payload = JSON.parse(rawBody) as Record<string, unknown>;
        if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
          return { challenge: payload.challenge };
        }
        return handleSlackEventEnvelope(payload, { rawPayload: rawBody, source: 'http' });
      }
    }
  };
}
