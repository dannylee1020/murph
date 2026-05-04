import { createHmac, timingSafeEqual } from 'node:crypto';
import { decryptString, encryptString } from '#lib/server/util/crypto';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getStore } from '#lib/server/persistence/store';
import type { ChannelMessage, ThreadRef, Workspace } from '#lib/types';

interface OAuthExchangeResponse {
  ok: boolean;
  error?: string;
  team?: { id: string; name: string };
  access_token?: string;
  bot_user_id?: string;
}

interface ConversationsRepliesResponse {
  ok: boolean;
  error?: string;
  messages?: Array<{ user?: string; text?: string; ts?: string }>;
}

interface SearchMessagesResponse {
  ok: boolean;
  error?: string;
  messages?: {
    matches?: Array<{
      iid?: string;
      channel?: { id?: string; name?: string };
      text?: string;
      ts?: string;
      permalink?: string;
      username?: string;
      user?: string;
    }>;
  };
}

interface ChatPostMessageResponse {
  ok: boolean;
  error?: string;
  ts?: string;
}

interface ConversationsInfoResponse {
  ok: boolean;
  error?: string;
  channel?: {
    id?: string;
    name?: string;
    is_member?: boolean;
    is_private?: boolean;
  };
}

interface ConversationsListResponse {
  ok: boolean;
  error?: string;
  channels?: Array<{
    id?: string;
    name?: string;
    is_member?: boolean;
    is_private?: boolean;
    is_archived?: boolean;
  }>;
}

interface ConversationsJoinResponse {
  ok: boolean;
  error?: string;
}

interface UsersListResponse {
  ok: boolean;
  error?: string;
  members?: Array<{
    id: string;
    name?: string;
    real_name?: string;
    is_bot?: boolean;
    deleted?: boolean;
    profile?: {
      display_name?: string;
      real_name?: string;
      image_48?: string;
    };
  }>;
}

export interface SlackMember {
  id: string;
  displayName: string;
  avatar?: string;
}

export interface SlackChannelInfo {
  id: string;
  name?: string;
  isMember: boolean;
  isPrivate: boolean;
}

export interface SlackChannelChoice extends SlackChannelInfo {
  displayName: string;
}

export interface SlackJoinResult {
  ok: boolean;
  error?: string;
}

export interface SlackSearchResult {
  id: string;
  channelId: string;
  channelName?: string;
  threadTs: string;
  text: string;
  permalink?: string;
  userId?: string;
}

export class SlackService {
  private readonly env = getRuntimeEnv();
  private readonly store = getStore();

  buildInstallUrl(appUrl = this.env.appUrl): string | undefined {
    if (!this.env.slackClientId) {
      return undefined;
    }

    const redirectUri = `${appUrl}/api/slack/oauth/callback`;
    const params = new URLSearchParams({
      client_id: this.env.slackClientId,
      scope:
        'app_mentions:read,channels:history,channels:read,channels:join,chat:write,groups:history,groups:read,im:history,mpim:history,users:read',
      redirect_uri: redirectUri
    });

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, appUrl = this.env.appUrl): Promise<Workspace> {
    if (!this.env.slackClientId || !this.env.slackClientSecret) {
      throw new Error('Slack OAuth is not configured');
    }

    if (!this.env.encryptionKey) {
      throw new Error('MURPH_ENCRYPTION_KEY is required to store Slack bot tokens');
    }

    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.slackClientId,
        client_secret: this.env.slackClientSecret,
        code,
        redirect_uri: `${appUrl}/api/slack/oauth/callback`
      })
    });
    const payload = (await response.json()) as OAuthExchangeResponse;

    if (!payload.ok || !payload.team?.id || !payload.access_token) {
      throw new Error(payload.error ?? 'Slack OAuth exchange failed');
    }

    return this.store.saveInstall({
      provider: 'slack',
      externalWorkspaceId: payload.team.id,
      name: payload.team.name ?? payload.team.id,
      botTokenEncrypted: encryptString(payload.access_token, this.env.encryptionKey),
      botUserId: payload.bot_user_id
    });
  }

  verifySignature(headers: Headers, rawBody: string): boolean {
    if (!this.env.slackSigningSecret) {
      return true;
    }

    const timestamp = headers.get('x-slack-request-timestamp');
    const signature = headers.get('x-slack-signature');

    if (!timestamp || !signature) {
      return false;
    }

    const base = `v0:${timestamp}:${rawBody}`;
    const expected =
      'v0=' +
      createHmac('sha256', this.env.slackSigningSecret).update(base).digest('hex');

    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  getBotToken(workspaceIdOrTeamId: string): string {
    const workspace =
      this.store.getWorkspaceById(workspaceIdOrTeamId) ??
      this.store.getWorkspaceByExternalId('slack', workspaceIdOrTeamId) ??
      this.store.getWorkspaceByTeamId(workspaceIdOrTeamId) ??
      this.store.getFirstWorkspace();

    if (!workspace?.botTokenEncrypted) {
      throw new Error('No Slack install found');
    }

    if (!this.env.encryptionKey) {
      throw new Error('MURPH_ENCRYPTION_KEY is required to read Slack bot tokens');
    }

    return decryptString(workspace.botTokenEncrypted, this.env.encryptionKey);
  }

  async fetchThreadMessages(
    workspace: Workspace,
    thread: ThreadRef
  ): Promise<ChannelMessage[]> {
    const response = await fetch('https://slack.com/api/conversations.replies', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.getBotToken(workspace.externalWorkspaceId)}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        channel: thread.channelId,
        ts: thread.threadTs,
        inclusive: 'true',
        limit: '20'
      })
    });
    const payload = (await response.json()) as ConversationsRepliesResponse;

    if (!payload.ok || !payload.messages) {
      throw new Error(payload.error ?? 'Failed to fetch Slack thread');
    }

    return payload.messages.map((message) => ({
      provider: 'slack',
      userId: message.user,
      authorId: message.user,
      text: message.text ?? '',
      ts: message.ts ?? thread.threadTs,
      messageId: message.ts ?? thread.threadTs,
      createdAt: message.ts
    }));
  }

  async searchMessages(workspace: Workspace, query: string, limit = 5): Promise<SlackSearchResult[]> {
    const response = await fetch('https://slack.com/api/search.messages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.getBotToken(workspace.externalWorkspaceId)}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        query,
        count: String(Math.max(1, Math.min(limit, 10))),
        sort: 'timestamp',
        sort_dir: 'desc'
      })
    });
    const payload = (await response.json()) as SearchMessagesResponse;

    if (!payload.ok) {
      throw new Error(payload.error ?? 'Failed to search Slack messages');
    }

    return (payload.messages?.matches ?? [])
      .filter((match) => match.channel?.id && match.ts)
      .map((match) => ({
        id: match.iid ?? `slack:${match.channel?.id}:${match.ts}`,
        channelId: match.channel!.id!,
        channelName: match.channel?.name,
        threadTs: match.ts!,
        text: match.text ?? '',
        permalink: match.permalink,
        userId: match.user
      }));
  }

  async postReply(workspace: Workspace, thread: ThreadRef, text: string): Promise<void> {
    await this.postMessage(workspace, thread.channelId, text, thread.threadTs);
  }

  async postMessage(workspace: Workspace, channelId: string, text: string, threadTs?: string): Promise<{ ts?: string }> {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.getBotToken(workspace.externalWorkspaceId)}`,
        'content-type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        channel: channelId,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        text
      })
    });
    const payload = (await response.json()) as ChatPostMessageResponse;

    if (!payload.ok) {
      throw new Error(payload.error ?? 'Failed to post Slack message');
    }

    return { ts: payload.ts };
  }

  async getChannelInfo(workspace: Workspace, channelId: string): Promise<SlackChannelInfo> {
    const response = await fetch('https://slack.com/api/conversations.info', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.getBotToken(workspace.externalWorkspaceId)}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        channel: channelId
      })
    });
    const payload = (await response.json()) as ConversationsInfoResponse;

    if (!payload.ok || !payload.channel?.id) {
      throw new Error(payload.error ?? 'Failed to fetch Slack channel info');
    }

    return {
      id: payload.channel.id,
      name: payload.channel.name,
      isMember: Boolean(payload.channel.is_member),
      isPrivate: Boolean(payload.channel.is_private)
    };
  }

  async listMembers(workspace: Workspace): Promise<SlackMember[]> {
    const response = await fetch('https://slack.com/api/users.list', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.getBotToken(workspace.externalWorkspaceId)}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ limit: '200' })
    });
    const payload = (await response.json()) as UsersListResponse;

    if (!payload.ok) {
      throw new Error(payload.error ?? 'Failed to list Slack members');
    }

    return (payload.members ?? [])
      .filter((m) => !m.is_bot && !m.deleted && m.id !== 'USLACKBOT')
      .map((m) => ({
        id: m.id,
        displayName: m.profile?.display_name || m.profile?.real_name || m.real_name || m.name || m.id,
        avatar: m.profile?.image_48
      }));
  }

  async listChannels(workspace: Workspace): Promise<SlackChannelChoice[]> {
    const response = await fetch('https://slack.com/api/conversations.list', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.getBotToken(workspace.externalWorkspaceId)}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        types: 'public_channel,private_channel',
        exclude_archived: 'true',
        limit: '200'
      })
    });
    const payload = (await response.json()) as ConversationsListResponse;

    if (!payload.ok) {
      throw new Error(payload.error ?? 'Failed to list Slack channels');
    }

    return (payload.channels ?? [])
      .filter((channel) => channel.id && channel.name && !channel.is_archived)
      .map((channel) => ({
        id: channel.id!,
        name: channel.name,
        displayName: `#${channel.name}`,
        isMember: Boolean(channel.is_member),
        isPrivate: Boolean(channel.is_private)
      }))
      .sort((a, b) => {
        if (a.isMember !== b.isMember) {
          return a.isMember ? -1 : 1;
        }
        if (a.isPrivate !== b.isPrivate) {
          return a.isPrivate ? 1 : -1;
        }
        return a.displayName.localeCompare(b.displayName);
      });
  }

  async joinChannel(workspace: Workspace, channelId: string): Promise<SlackJoinResult> {
    const response = await fetch('https://slack.com/api/conversations.join', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.getBotToken(workspace.externalWorkspaceId)}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        channel: channelId
      })
    });
    const payload = (await response.json()) as ConversationsJoinResponse;

    return {
      ok: Boolean(payload.ok),
      error: payload.error
    };
  }
}

let slackService: SlackService | null = null;

export function getSlackService(): SlackService {
  if (!slackService) {
    slackService = new SlackService();
  }

  return slackService;
}
