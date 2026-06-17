import { getSlackService, type SlackPresence } from '#app/server/channels/slack/service';
import { getStore } from '#app/server/persistence/store';
import type { AutopilotSession } from '#app/types';

function isSlackChannelCoverageSession(session: AutopilotSession): boolean {
  if (session.channelScope.length === 0) return true;
  return session.channelScope.some((channelId) => !channelId.startsWith('D'));
}

async function setWorkspacePresence(workspaceId: string, presence: SlackPresence): Promise<void> {
  const store = getStore();
  const workspace = store.getWorkspaceById(workspaceId);
  if (!workspace || workspace.provider !== 'slack') return;

  try {
    await getSlackService().setPresence(workspace, presence);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[slack] failed to set bot presence to ${presence}: ${message}`);
  }
}

export async function syncSlackPresenceForWorkspace(workspaceId: string): Promise<void> {
  const store = getStore();
  const hasActiveCoverage = store
    .listActiveSessions(workspaceId)
    .some(isSlackChannelCoverageSession);
  await setWorkspacePresence(workspaceId, hasActiveCoverage ? 'auto' : 'away');
}

export async function syncSlackPresenceForSessions(sessions: AutopilotSession[]): Promise<void> {
  const workspaceIds = [...new Set(sessions.map((session) => session.workspaceId))];
  for (const workspaceId of workspaceIds) {
    await syncSlackPresenceForWorkspace(workspaceId);
  }
}
