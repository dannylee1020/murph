import { randomUUID } from 'node:crypto';
import { getStore } from '#lib/server/persistence/store';
import { getSlackService } from '#lib/server/channels/slack/service';
import type { AutopilotSession, ChannelAdapter, ChannelThreadRef, ContinuityTask } from '#lib/types';

export type SlackIgnoredReason =
  | 'unsupported_event_subtype'
  | 'bot_message'
  | 'missing_workspace'
  | 'workspace_not_installed'
  | 'missing_channel'
  | 'missing_thread_ts'
  | 'no_mentioned_session_owner'
  | 'ambiguous_session_target';

export type SlackNormalizeResult =
  | { task: ContinuityTask; ignoredReason?: never }
  | { task?: never; ignoredReason: SlackIgnoredReason };

function buildThreadRef(channelId: string, threadTs: string): ChannelThreadRef {
  return { provider: 'slack', channelId, threadTs };
}

function parseMentionedUsers(text: string): string[] {
  return [...text.matchAll(/<@([A-Z0-9]+)>/gi)].map((match) => match[1]);
}

function isScopedToChannel(session: AutopilotSession, channelId: string): boolean {
  return session.channelScope.length === 0 || session.channelScope.includes(channelId);
}

function activeSessionForUser(sessions: AutopilotSession[], userId: string | undefined): AutopilotSession | undefined {
  return userId ? sessions.find((session) => session.ownerSlackUserId === userId) : undefined;
}

export function normalizeSlackEvent(
  event: Record<string, unknown>,
  envelope?: { eventId?: string; teamId?: string }
): SlackNormalizeResult {
  const workspaceId = envelope?.teamId ?? (typeof event.team_id === 'string' ? event.team_id : null);
  const channelId = typeof event.channel === 'string' ? event.channel : null;
  const threadTs =
    typeof event.thread_ts === 'string'
      ? event.thread_ts
      : typeof event.ts === 'string'
        ? event.ts
        : null;
  const actorUserId = typeof event.user === 'string' ? event.user : undefined;
  const eventType = typeof event.type === 'string' ? event.type : 'unknown';
  const text = typeof event.text === 'string' ? event.text : '';
  const subtype = typeof event.subtype === 'string' ? event.subtype : undefined;
  const botId = typeof event.bot_id === 'string' ? event.bot_id : undefined;
  const store = getStore();

  if (subtype) {
    return { ignoredReason: botId || subtype === 'bot_message' ? 'bot_message' : 'unsupported_event_subtype' };
  }

  if (botId) {
    return { ignoredReason: 'bot_message' };
  }

  if (!workspaceId) {
    return { ignoredReason: 'missing_workspace' };
  }

  const workspace = store.getWorkspaceByTeamId(workspaceId) ?? store.getWorkspaceById(workspaceId);

  if (!workspace) {
    return { ignoredReason: 'workspace_not_installed' };
  }

  if (!channelId) {
    return { ignoredReason: 'missing_channel' };
  }

  if (!threadTs) {
    return { ignoredReason: 'missing_thread_ts' };
  }

  if (!actorUserId || actorUserId === workspace.botUserId) {
    return { ignoredReason: 'bot_message' };
  }

  const scopedSessions = store.listActiveSessions(workspace.id).filter((session) => isScopedToChannel(session, channelId));
  const ignoredMentionIds = new Set([actorUserId, workspace.botUserId].filter((id): id is string => Boolean(id)));
  const mentionedUsers = parseMentionedUsers(text).filter((userId) => !ignoredMentionIds.has(userId));
  const mentionedSessionTarget = mentionedUsers.find((userId) => activeSessionForUser(scopedSessions, userId));
  const storedTarget = store.getThreadState(workspace.id, channelId, threadTs)?.targetUserId;
  const storedSessionTarget = activeSessionForUser(scopedSessions, storedTarget)?.ownerSlackUserId;
  const botDirected = Boolean(workspace.botUserId && parseMentionedUsers(text).includes(workspace.botUserId));
  const singleSessionTarget = scopedSessions.length === 1 ? scopedSessions[0].ownerSlackUserId : undefined;
  const fallbackTarget = botDirected ? singleSessionTarget : undefined;
  const targetUserId = mentionedSessionTarget ?? storedSessionTarget ?? fallbackTarget;

  if (!targetUserId) {
    return {
      ignoredReason: botDirected && scopedSessions.length > 1 ? 'ambiguous_session_target' : 'no_mentioned_session_owner'
    };
  }

  return {
    task: {
      id: randomUUID(),
      source: 'slack_event',
      workspaceId,
      thread: buildThreadRef(channelId, threadTs),
      targetUserId,
      actorUserId,
      rawEventId: envelope?.eventId,
      eventType,
      dedupeKey: `${workspaceId}:${envelope?.eventId ?? `${channelId}:${threadTs}:${eventType}`}`,
      receivedAt: new Date().toISOString()
    }
  };
}

export function createSlackChannelAdapter(): ChannelAdapter {
  const slack = getSlackService();

  return {
    id: 'slack',
    displayName: 'Slack',
    capabilities: ['event_ingress', 'thread_fetch', 'reply_post', 'message_post', 'membership_check', 'self_join'],

    normalizeEvent(event, envelope) {
      return normalizeSlackEvent(event, envelope).task ?? null;
    },

    async fetchThread(workspace, thread) {
      return await slack.fetchThreadMessages(workspace, thread);
    },

    async postReply(workspace, thread, text) {
      await slack.postReply(workspace, thread, text);
    },

    async postMessage(workspace, channelId, text) {
      return await slack.postMessage(workspace, channelId, text);
    },

    async checkMembership(workspace, channelId) {
      return await slack.getChannelInfo(workspace, channelId);
    },

    async ensureMember(workspace, channelId) {
      try {
        const info = await slack.getChannelInfo(workspace, channelId);

        if (info.isMember) {
          return { channelId, name: info.name, status: 'already_member' };
        }

        if (info.isPrivate) {
          return {
            channelId,
            name: info.name,
            status: 'requires_invitation',
            reason: 'Slack bots cannot join private channels without an invite.'
          };
        }

        const joined = await slack.joinChannel(workspace, channelId);

        if (joined.ok) {
          return { channelId, name: info.name, status: 'joined' };
        }

        if (joined.error === 'missing_scope') {
          return {
            channelId,
            name: info.name,
            status: 'reinstall_required',
            reason: 'Slack app is missing channels:join scope.'
          };
        }

        return {
          channelId,
          name: info.name,
          status: 'error',
          reason: joined.error ?? 'Slack channel join failed.'
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Slack channel membership check failed.';
        return { channelId, status: message === 'missing_scope' ? 'reinstall_required' : 'error', reason: message };
      }
    }
  };
}
