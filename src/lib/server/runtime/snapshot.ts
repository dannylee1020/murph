import { listRegisteredPluginManifests } from '#lib/server/capabilities/plugins';
import { getChannelRegistry } from '#lib/server/capabilities/channel-registry';
import { getContextSourceRegistry } from '#lib/server/capabilities/context-source-registry';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import { getDiscordService } from '#lib/server/channels/discord/service';
import { getSlackService } from '#lib/server/channels/slack/service';
import { getStore } from '#lib/server/persistence/store';
import { getToolRegistry } from '#lib/server/capabilities/tool-registry';

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
      ? store.listUsers(summary.workspace.id).map((user) => {
          const memory = store.getOrCreateUserMemory(summary.workspace!.id, user.externalUserId);
          return {
            ...user,
            policyConfigured: Boolean(memory.policy),
            policy: memory.policy
          };
        })
      : [],
    sessions: summary.workspace ? store.listActiveSessions(summary.workspace.id) : [],
    traces: store.listRunSummaries(undefined, 10)
  };
}
