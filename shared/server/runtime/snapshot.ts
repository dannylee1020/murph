import { listRegisteredPluginManifests } from '#shared/server/capabilities/plugins';
import { getChannelRegistry } from '#shared/server/capabilities/channel-registry';
import { getContextSourceRegistry } from '#shared/server/capabilities/context-source-registry';
import { ensureRuntimeInitialized } from '#shared/server/runtime/bootstrap';
import { getDiscordService } from '#shared/server/channels/discord/service';
import { getSlackService } from '#shared/server/channels/slack/service';
import { getStore } from '#shared/server/persistence/store';
import { getToolRegistry } from '#shared/server/capabilities/tool-registry';

export async function getGatewaySnapshot() {
  await ensureRuntimeInitialized();
  const store = getStore();
  const summary = store.getWorkspaceSummary();

  return {
    summary: {
      ...summary,
      installUrl: summary.workspace?.provider === 'discord'
        ? getDiscordService().buildInstallUrl()
        : getSlackService().buildInstallUrl() ?? getDiscordService().buildInstallUrl(),
      channelCount: getChannelRegistry().list().length,
      contextSourceCount: getContextSourceRegistry().list().length,
      toolCount: getToolRegistry().list().length,
      pluginCount: listRegisteredPluginManifests().length
    },
    users: summary.workspace
      ? store.listUsers(summary.workspace.id)
      : [],
    sessions: store.listActiveSessions(),
    traces: store.listRunSummaries(undefined, 10)
  };
}
