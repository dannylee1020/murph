import { randomUUID } from 'node:crypto';
import { getStore } from '#app/server/persistence/store';
import { getSlackService } from '#app/server/channels/slack/service';
import { resolvePersonalDirectTarget, type PersonalDirectIgnoredReason } from '#app/server/channels/personal-routing';
import type { AutopilotSession, ChannelAdapter, ChannelThreadRef, ContinuityTask } from '#app/types';

export type SlackIgnoredReason =
  | 'unsupported_event_subtype'
  | 'bot_message'
  | 'missing_workspace'
  | 'workspace_not_installed'
  | 'missing_channel'
  | 'missing_thread_ts'
  | 'no_mentioned_session_owner'
  | 'no_active_team_session'
  | 'bot_not_mentioned'
  | 'ambiguous_session_target'
  | 'channel_bot_direct_message'
  | 'personal_bot_channel_message'
  | PersonalDirectIgnoredReason;

export type SlackNormalizeResult =
  | { task: ContinuityTask; ignoredReason?: never }
  | { task?: never; ignoredReason: SlackIgnoredReason };

function buildThreadRef(channelId: string, threadTs: string): ChannelThreadRef {
  return { provider: 'slack', channelId, threadTs };
}

function buildTriggerMessage(
  channelId: string,
  messageTs: string,
  actorUserId: string,
  text: string
): ContinuityTask['triggerMessage'] {
  return {
    provider: 'slack',
    userId: actorUserId,
    authorId: actorUserId,
    text,
    ts: messageTs,
    messageId: messageTs,
    createdAt: messageTs
  };
}

function slackMessageDedupeKey(input: {
  workspaceId: string;
  botRole: 'personal' | 'channel';
  channelId: string;
  messageTs: string;
}): string {
  return `${input.workspaceId}:${input.botRole}:message:${input.channelId}:${input.messageTs}`;
}

function parseMentionedUsers(text: string): string[] {
  return [...text.matchAll(/<@([A-Z0-9]+)>/gi)].map((match) => match[1]);
}

function isScopedToChannel(session: AutopilotSession, channelId: string): boolean {
  return session.channelScope.length === 0 || session.channelScope.includes(channelId);
}

function activeSessionById(sessions: AutopilotSession[], sessionId: string | undefined): AutopilotSession | undefined {
  return sessionId ? sessions.find((session) => session.id === sessionId) : undefined;
}

export function normalizeSlackEvent(
  event: Record<string, unknown>,
  envelope?: { eventId?: string; teamId?: string; botRole?: 'personal' | 'channel'; botInstallationId?: string }
): SlackNormalizeResult {
  const workspaceId = envelope?.teamId ?? (typeof event.team_id === 'string' ? event.team_id : null);
  const channelId = typeof event.channel === 'string' ? event.channel : null;
  const messageTs = typeof event.ts === 'string' ? event.ts : null;
  const threadTs =
    typeof event.thread_ts === 'string'
      ? event.thread_ts
      : messageTs;
  const actorUserId = typeof event.user === 'string' ? event.user : undefined;
  const eventType = typeof event.type === 'string' ? event.type : 'unknown';
  const text = typeof event.text === 'string' ? event.text : '';
  const subtype = typeof event.subtype === 'string' ? event.subtype : undefined;
  const botId = typeof event.bot_id === 'string' ? event.bot_id : undefined;
  const isDirectMessage = event.channel_type === 'im' || Boolean(channelId?.startsWith('D'));
  const botRole = envelope?.botRole ?? 'channel';
  const store = getStore();

  if (subtype) {
    return { ignoredReason: botId || subtype === 'bot_message' ? 'bot_message' : 'unsupported_event_subtype' };
  }

  if (botId) {
    return { ignoredReason: 'bot_message' };
  }

  if (!workspaceId) {
    if (!isDirectMessage) {
      return { ignoredReason: 'missing_workspace' };
    }
  }

  const workspace = workspaceId
    ? store.getWorkspaceByExternalId('slack', workspaceId) ?? store.getWorkspaceById(workspaceId)
    : undefined;

  if (!workspace && !isDirectMessage) {
    return { ignoredReason: 'workspace_not_installed' };
  }

  if (!channelId) {
    return { ignoredReason: 'missing_channel' };
  }

  if (!threadTs) {
    return { ignoredReason: 'missing_thread_ts' };
  }

  if (!messageTs) {
    return { ignoredReason: 'missing_thread_ts' };
  }

  if (!actorUserId || actorUserId === workspace?.botUserId) {
    return { ignoredReason: 'bot_message' };
  }

  if (isDirectMessage) {
    if (botRole !== 'personal') {
      return { ignoredReason: 'channel_bot_direct_message' };
    }
    const target = resolvePersonalDirectTarget('slack', actorUserId, {
      botInstallationId: envelope?.botInstallationId,
      externalWorkspaceId: workspaceId ?? undefined
    });
    if (!target.ok) {
      return { ignoredReason: target.ignoredReason };
    }
    if (workspace && workspace.id !== target.workspace.id) {
      return { ignoredReason: 'workspace_not_installed' };
    }

    store.upsertDirectConversation({
      provider: 'slack',
      botInstallationId: envelope?.botInstallationId,
      workspaceId: target.workspace.id,
      externalUserId: actorUserId,
      channelId,
      lastSelectedWorkspaceId: target.workspace.id
    });

    return {
      task: {
        id: randomUUID(),
        source: 'slack_event',
        workspaceId: target.workspace.externalWorkspaceId,
        botRole,
        botInstallationId: envelope?.botInstallationId,
        thread: { ...buildThreadRef(channelId, threadTs), botRole, botInstallationId: envelope?.botInstallationId },
        conversationKind: 'direct',
        triggerMessage: buildTriggerMessage(channelId, messageTs, actorUserId, text),
        targetUserId: target.ownerUserId,
        actorUserId,
        rawEventId: envelope?.eventId,
        eventType,
        dedupeKey: slackMessageDedupeKey({
          workspaceId: target.workspace.externalWorkspaceId,
          botRole,
          channelId,
          messageTs
        }),
        receivedAt: new Date().toISOString()
      }
    };
  }

  if (!workspace) {
    return { ignoredReason: 'workspace_not_installed' };
  }
  if (botRole === 'personal') {
    return { ignoredReason: 'personal_bot_channel_message' };
  }

  const botDirected = Boolean(workspace.botUserId && parseMentionedUsers(text).includes(workspace.botUserId));
  const scopedSessions = store.listActiveSessions(workspace.id).filter((session) => (
    !session.ownerUserId && isScopedToChannel(session, channelId)
  ));
  const storedState = store.getThreadState(workspace.id, channelId, threadTs);
  const storedSession = activeSessionById(scopedSessions, storedState?.sessionId);
  const session = storedSession ?? (botDirected && scopedSessions.length === 1 ? scopedSessions[0] : undefined);

  if (!session) {
    if (!botDirected && !storedSession) {
      return { ignoredReason: 'bot_not_mentioned' };
    }
    return {
      ignoredReason: scopedSessions.length > 1 ? 'ambiguous_session_target' : 'no_active_team_session'
    };
  }

  const externalWorkspaceId = workspace.externalWorkspaceId;
  return {
    task: {
      id: randomUUID(),
      source: 'slack_event',
      workspaceId: externalWorkspaceId,
      botRole: 'channel',
      botInstallationId: envelope?.botInstallationId,
      thread: { ...buildThreadRef(channelId, threadTs), botRole: 'channel', botInstallationId: envelope?.botInstallationId },
      sessionId: session.id,
      conversationKind: 'channel',
      triggerMessage: buildTriggerMessage(channelId, messageTs, actorUserId, text),
      actorUserId,
      rawEventId: envelope?.eventId,
      eventType,
      dedupeKey: slackMessageDedupeKey({
        workspaceId: externalWorkspaceId,
        botRole: 'channel',
        channelId,
        messageTs
      }),
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
