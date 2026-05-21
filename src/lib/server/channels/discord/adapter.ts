import { randomUUID } from 'node:crypto';
import { getStore } from '#lib/server/persistence/store';
import { getDiscordService } from '#lib/server/channels/discord/service';
import type { AutopilotSession, ChannelAdapter, ChannelThreadRef, ContinuityTask } from '#lib/types';

export type DiscordIgnoredReason =
  | 'missing_workspace'
  | 'workspace_not_installed'
  | 'bot_message'
  | 'missing_thread'
  | 'no_mentioned_session_owner'
  | 'ambiguous_session_target';

export type DiscordNormalizeResult =
  | { task: ContinuityTask; ignoredReason?: never }
  | { task?: never; ignoredReason: DiscordIgnoredReason };

function parseMentionedUsers(text: string): string[] {
  return [...text.matchAll(/<@!?(\d+)>/g)].map((match) => match[1]);
}

function parseMentionedUsersFromEvent(event: Record<string, unknown>, text: string): string[] {
  const ids = new Set(parseMentionedUsers(text));
  const mentions = Array.isArray(event.mentions) ? event.mentions : [];
  for (const mention of mentions) {
    if (mention && typeof mention === 'object' && typeof (mention as { id?: unknown }).id === 'string') {
      ids.add((mention as { id: string }).id);
    }
  }
  return [...ids];
}

function isScopedToChannel(session: AutopilotSession, channelId: string): boolean {
  return session.channelScope.length === 0 || session.channelScope.includes(channelId);
}

function activeSessionForUser(sessions: AutopilotSession[], userId: string | undefined): AutopilotSession | undefined {
  return userId ? sessions.find((session) => session.ownerUserId === userId) : undefined;
}

function buildThreadRef(event: Record<string, unknown>): ChannelThreadRef | null {
  const channelId = typeof event.channel_id === 'string' ? event.channel_id : undefined;
  const messageId = typeof event.id === 'string' ? event.id : undefined;
  if (!channelId || !messageId) {
    return null;
  }

  const type = typeof event.type === 'number' ? event.type : undefined;
  const parentId = typeof event.parent_id === 'string' ? event.parent_id : undefined;
  if (type === 11 || parentId) {
    return {
      provider: 'discord',
      channelId: parentId ?? channelId,
      threadTs: channelId,
      threadChannelId: channelId
    };
  }

  return {
    provider: 'discord',
    channelId,
    threadTs: messageId,
    rootMessageId: messageId
  };
}

function buildTriggerMessage(
  thread: ChannelThreadRef,
  actorUserId: string,
  text: string,
  event: Record<string, unknown>
): ContinuityTask['triggerMessage'] {
  const messageId = typeof event.id === 'string' ? event.id : thread.threadTs;
  const timestamp = typeof event.timestamp === 'string' ? event.timestamp : undefined;
  return {
    provider: 'discord',
    userId: actorUserId,
    authorId: actorUserId,
    text,
    ts: messageId,
    messageId,
    createdAt: timestamp
  };
}

export function normalizeDiscordEvent(
  event: Record<string, unknown>,
  envelope?: { eventId?: string; teamId?: string }
): ContinuityTask | null {
  return normalizeDiscordEventWithReason(event, envelope).task ?? null;
}

export function normalizeDiscordEventWithReason(
  event: Record<string, unknown>,
  envelope?: { eventId?: string; teamId?: string }
): DiscordNormalizeResult {
  const workspaceId = envelope?.teamId ?? (typeof event.guild_id === 'string' ? event.guild_id : undefined);
  if (!workspaceId) {
    return { ignoredReason: 'missing_workspace' };
  }

  const store = getStore();
  const workspace = store.getWorkspaceByExternalId('discord', workspaceId) ?? store.getWorkspaceById(workspaceId);
  if (!workspace) {
    return { ignoredReason: 'workspace_not_installed' };
  }

  const actorUserId = typeof event.author === 'object' && event.author && typeof (event.author as { id?: unknown }).id === 'string'
    ? (event.author as { id: string }).id
    : undefined;
  if (!actorUserId || actorUserId === workspace.botUserId) {
    return { ignoredReason: 'bot_message' };
  }

  const thread = buildThreadRef(event);
  if (!thread) {
    return { ignoredReason: 'missing_thread' };
  }

  const text = typeof event.content === 'string' ? event.content : '';
  const scopedSessions = store.listActiveSessions(workspace.id).filter((session) => isScopedToChannel(session, thread.channelId));
  const allMentionedUsers = parseMentionedUsersFromEvent(event, text);
  const mentionedUsers = allMentionedUsers.filter((userId) => userId !== actorUserId && userId !== workspace.botUserId);
  const mentionedSessionTarget = mentionedUsers.find((userId) => activeSessionForUser(scopedSessions, userId));
  const storedTarget = store.getThreadState(workspace.id, thread.channelId, thread.threadTs)?.targetUserId;
  const storedSessionTarget = activeSessionForUser(scopedSessions, storedTarget)?.ownerUserId;
  const botDirected = Boolean(workspace.botUserId && allMentionedUsers.includes(workspace.botUserId));
  const singleSessionTarget = scopedSessions.length === 1 ? scopedSessions[0].ownerUserId : undefined;
  const targetUserId = mentionedSessionTarget ?? storedSessionTarget ?? (botDirected ? singleSessionTarget : undefined);

  if (!targetUserId) {
    return {
      ignoredReason: botDirected && scopedSessions.length > 1 ? 'ambiguous_session_target' : 'no_mentioned_session_owner'
    };
  }

  return {
    task: {
      id: randomUUID(),
      source: 'discord_event',
      workspaceId,
      thread,
      triggerMessage: buildTriggerMessage(thread, actorUserId, text, event),
      targetUserId,
      actorUserId,
      rawEventId: envelope?.eventId,
      eventType: 'MESSAGE_CREATE',
      dedupeKey: `discord:${workspaceId}:${envelope?.eventId ?? `${thread.channelId}:${thread.threadTs}`}`,
      receivedAt: new Date().toISOString()
    }
  };
}

export function createDiscordChannelAdapter(): ChannelAdapter {
  const discord = getDiscordService();

  return {
    id: 'discord',
    displayName: 'Discord',
    capabilities: ['event_ingress', 'thread_fetch', 'reply_post', 'message_post'],

    normalizeEvent(event, envelope) {
      return normalizeDiscordEvent(event, envelope);
    },

    async fetchThread(workspace, thread) {
      return await discord.fetchThreadMessages(workspace, thread);
    },

    async postReply(workspace, thread, text) {
      await discord.postReply(workspace, thread, text);
    },

    async postMessage(workspace, channelId, text) {
      return await discord.postMessage(workspace, channelId, text);
    }
  };
}
