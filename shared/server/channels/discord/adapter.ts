import { randomUUID } from 'node:crypto';
import { getStore } from '#shared/server/persistence/store';
import { getDiscordService } from '#shared/server/channels/discord/service';
import { resolvePersonalDirectTarget, type PersonalDirectIgnoredReason } from '#shared/server/channels/personal-routing';
import type { AutopilotSession, ChannelAdapter, ChannelThreadRef, ContinuityTask, WorkspaceSubscription } from '#shared/types';

export type DiscordIgnoredReason =
  | 'missing_workspace'
  | 'workspace_not_installed'
  | 'bot_message'
  | 'missing_thread'
  | 'no_mentioned_session_owner'
  | 'ambiguous_session_target'
  | 'channel_bot_direct_message'
  | 'personal_bot_channel_message'
  | PersonalDirectIgnoredReason;

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

function filterSubscribedSessions(
  sessions: AutopilotSession[],
  subscribedUserIds: Set<string>
): AutopilotSession[] {
  return sessions.filter((session) => subscribedUserIds.has(session.ownerUserId));
}

function subscriptionAllowsChannel(
  subscription: WorkspaceSubscription,
  channelId: string
): boolean {
  return subscription.channelScopeMode === 'all_accessible' || subscription.channelScope.includes(channelId);
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
  envelope?: { eventId?: string; teamId?: string; botRole?: 'personal' | 'channel'; botInstallationId?: string }
): ContinuityTask | null {
  return normalizeDiscordEventWithReason(event, envelope).task ?? null;
}

export function normalizeDiscordEventWithReason(
  event: Record<string, unknown>,
  envelope?: { eventId?: string; teamId?: string; botRole?: 'personal' | 'channel'; botInstallationId?: string }
): DiscordNormalizeResult {
  const workspaceId = envelope?.teamId ?? (typeof event.guild_id === 'string' ? event.guild_id : undefined);
  const store = getStore();
  const workspace = workspaceId
    ? store.getWorkspaceByExternalId('discord', workspaceId) ?? store.getWorkspaceById(workspaceId)
    : undefined;
  const actorUserId = typeof event.author === 'object' && event.author && typeof (event.author as { id?: unknown }).id === 'string'
    ? (event.author as { id: string }).id
    : undefined;
  const botRole = envelope?.botRole ?? 'channel';
  if (!workspaceId && actorUserId) {
    if (botRole !== 'personal') {
      return { ignoredReason: 'channel_bot_direct_message' };
    }
    const target = resolvePersonalDirectTarget('discord', actorUserId, {
      botInstallationId: envelope?.botInstallationId
    });
    if (!target.ok) {
      return { ignoredReason: target.ignoredReason };
    }

    if (actorUserId === target.workspace.botUserId) {
      return { ignoredReason: 'bot_message' };
    }

    const thread = buildThreadRef(event);
    if (!thread) {
      return { ignoredReason: 'missing_thread' };
    }

    const text = typeof event.content === 'string' ? event.content : '';
    store.upsertDirectConversation({
      provider: 'discord',
      botInstallationId: envelope?.botInstallationId,
      workspaceId: target.workspace.id,
      externalUserId: actorUserId,
      channelId: thread.channelId,
      lastSelectedWorkspaceId: target.workspace.id
    });

    return {
      task: {
        id: randomUUID(),
        source: 'discord_event',
        workspaceId: target.workspace.id,
        botRole,
        botInstallationId: envelope?.botInstallationId,
        thread: { ...thread, botRole, botInstallationId: envelope?.botInstallationId },
        conversationKind: 'direct',
        triggerMessage: buildTriggerMessage(thread, actorUserId, text, event),
        targetUserId: target.ownerUserId,
        actorUserId,
        rawEventId: envelope?.eventId,
        eventType: 'MESSAGE_CREATE',
        dedupeKey: `discord:direct:${envelope?.eventId ?? `${thread.channelId}:${thread.threadTs}`}`,
        receivedAt: new Date().toISOString()
      }
    };
  }

  if (!workspaceId) {
    return { ignoredReason: 'missing_workspace' };
  }

  if (!workspace) {
    return { ignoredReason: 'workspace_not_installed' };
  }
  if (botRole === 'personal') {
    return { ignoredReason: 'personal_bot_channel_message' };
  }

  if (!actorUserId || actorUserId === workspace.botUserId) {
    return { ignoredReason: 'bot_message' };
  }

  const thread = buildThreadRef(event);
  if (!thread) {
    return { ignoredReason: 'missing_thread' };
  }

  const text = typeof event.content === 'string' ? event.content : '';
  const scopedSessions = store.listActiveSessions(workspace.id).filter((session) => isScopedToChannel(session, thread.channelId));
  const subscriptions = store.listWorkspaceSubscriptions(workspace.id);
  const subscribedUserIds = new Set(
    subscriptions
      .filter((subscription) => subscription.status === 'active' && subscriptionAllowsChannel(subscription, thread.channelId))
      .map((subscription) => subscription.externalUserId)
  );
  const eligibleSessions = filterSubscribedSessions(scopedSessions, subscribedUserIds);
  const allMentionedUsers = parseMentionedUsersFromEvent(event, text);
  const mentionedUsers = allMentionedUsers.filter((userId) => userId !== actorUserId && userId !== workspace.botUserId);
  const mentionedSessionTarget = mentionedUsers.find((userId) => activeSessionForUser(eligibleSessions, userId));
  const storedTarget = store.getThreadState(workspace.id, thread.channelId, thread.threadTs)?.targetUserId;
  const storedSessionTarget = activeSessionForUser(eligibleSessions, storedTarget)?.ownerUserId;
  const botDirected = Boolean(workspace.botUserId && allMentionedUsers.includes(workspace.botUserId));
  const singleSessionTarget = eligibleSessions.length === 1 ? eligibleSessions[0].ownerUserId : undefined;
  const targetUserId = mentionedSessionTarget ?? storedSessionTarget ?? (botDirected ? singleSessionTarget : undefined);

  if (!targetUserId) {
    return {
      ignoredReason: botDirected && eligibleSessions.length > 1 ? 'ambiguous_session_target' : 'no_mentioned_session_owner'
    };
  }

  return {
    task: {
      id: randomUUID(),
      source: 'discord_event',
      workspaceId,
      botRole: 'channel',
      botInstallationId: envelope?.botInstallationId,
      thread: { ...thread, botRole: 'channel', botInstallationId: envelope?.botInstallationId },
      conversationKind: 'channel',
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
