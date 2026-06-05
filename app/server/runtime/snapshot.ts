import { listRegisteredPluginManifests } from '#app/server/capabilities/plugins';
import { getChannelRegistry } from '#app/server/capabilities/channel-registry';
import { getContextSourceRegistry } from '#app/server/capabilities/context-source-registry';
import { ensureRuntimeInitialized } from '#app/server/runtime/bootstrap';
import { getDiscordService } from '#app/server/channels/discord/service';
import { getSlackService } from '#app/server/channels/slack/service';
import { getStore } from '#app/server/persistence/store';
import { getToolRegistry } from '#app/server/capabilities/tool-registry';

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
