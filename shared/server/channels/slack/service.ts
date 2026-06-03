import { createHmac, timingSafeEqual } from 'node:crypto';
import { getRuntimeEnv } from '#shared/server/util/env';
import { getStore } from '#shared/server/persistence/store';
import { listSecrets, readSecret, writeSecret } from '#shared/server/credentials/local-store';
import { reconcileIntegrationCapabilitiesForWorkspace } from '#shared/server/integrations/capabilities';
import { isSlackAppLevelToken } from '../../setup/slack-tokens.js';
import type { BotInstallation, BotRole, ChannelMessage, ThreadRef, Workspace } from '#shared/types';

interface OAuthExchangeResponse {
  ok: boolean;
  error?: string;
  team?: { id: string; name: string };
  access_token?: string;
  app_id?: string;
  bot_user_id?: string;
  authed_user?: {
    id?: string;
    access_token?: string;
  };
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

interface ConversationsOpenResponse {
  ok: boolean;
  error?: string;
  channel?: {
    id?: string;
  };
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

interface UsersInfoResponse {
  ok: boolean;
  error?: string;
  user?: {
    id: string;
    name?: string;
    real_name?: string;
    profile?: {
      display_name?: string;
      real_name?: string;
      image_48?: string;
    };
  };
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

export interface SlackInstallResult {
  workspace: Workspace;
  role: BotRole;
  botInstallation?: BotInstallation;
  authedUser?: SlackMember;
}

export class SlackService {
  private get store() {
    return getStore();
  }

  private get env() {
    return getRuntimeEnv();
  }

  private clientId(role: BotRole): string | undefined {
    const roleConfig = this.store.getBotAppConfig('slack', role);
    return role === 'personal'
      ? process.env.SLACK_PERSONAL_CLIENT_ID ?? roleConfig?.clientId
      : process.env.SLACK_CHANNEL_CLIENT_ID ?? process.env.SLACK_CLIENT_ID ?? roleConfig?.clientId;
  }

  private clientSecret(role: BotRole): string | undefined {
    return role === 'personal'
      ? process.env.SLACK_PERSONAL_CLIENT_SECRET ?? readSecret('slack', 'personal_client_secret')
      : process.env.SLACK_CHANNEL_CLIENT_SECRET ?? readSecret('slack', 'channel_client_secret') ?? this.env.slackClientSecret;
  }

  private signingSecret(role: BotRole): string | undefined {
    return role === 'personal'
      ? process.env.SLACK_PERSONAL_SIGNING_SECRET ?? readSecret('slack', 'personal_signing_secret')
      : process.env.SLACK_CHANNEL_SIGNING_SECRET ?? readSecret('slack', 'channel_signing_secret') ?? this.env.slackSigningSecret;
  }

  appToken(role: BotRole = 'channel'): string | undefined {
    return role === 'personal'
      ? process.env.SLACK_PERSONAL_APP_TOKEN ?? readSecret('slack', 'personal_app_token')
      : process.env.SLACK_CHANNEL_APP_TOKEN ?? readSecret('slack', 'channel_app_token') ?? this.env.slackAppToken;
  }

  private appId(role: BotRole): string | undefined {
    const roleConfig = this.store.getBotAppConfig('slack', role);
    return role === 'personal'
      ? process.env.SLACK_PERSONAL_APP_ID ?? roleConfig?.appId
      : process.env.SLACK_CHANNEL_APP_ID ?? process.env.SLACK_APP_ID ?? roleConfig?.appId;
  }

  private installationMatchesCurrentApp(installation: BotInstallation, role: BotRole): boolean {
    const appId = this.appId(role);
    if (!appId || installation.appId !== appId) return false;
    if (role === 'personal' && !installation.representedUserId) return false;
    return installation.status === 'active';
  }

  private eventsMode(role: BotRole): 'http' | 'socket' {
    const configured = process.env.SLACK_EVENTS_MODE === 'http'
      ? 'http'
      : process.env.SLACK_EVENTS_MODE === 'socket'
        ? 'socket'
        : this.store.getBotAppConfig('slack', role)?.eventsMode;
    return configured ?? 'socket';
  }

  isRoleOAuthConfigured(role: BotRole = 'channel'): boolean {
    return Boolean(this.clientId(role) && this.clientSecret(role));
  }

  isRoleSocketConfigured(role: BotRole = 'channel'): boolean {
    return isSlackAppLevelToken(this.appToken(role));
  }

  isRoleConfigured(role: BotRole = 'channel'): boolean {
    return Boolean(this.clientId(role) && this.clientSecret(role) && (this.eventsMode(role) === 'http' || this.isRoleSocketConfigured(role)));
  }

  buildInstallUrl(appUrl = this.env.appUrl, teamId?: string, source?: string, role: BotRole = 'channel'): string | undefined {
    const clientId = this.clientId(role);
    if (!clientId) {
      return undefined;
    }

    const redirectUri = `${appUrl}/api/slack/oauth/callback`;
    const scope = role === 'personal'
      ? 'chat:write,im:history,im:write'
      : 'app_mentions:read,channels:history,channels:read,channels:join,chat:write,commands,groups:history,groups:read';
    const params = new URLSearchParams({
      client_id: clientId,
      scope,
      redirect_uri: redirectUri
    });
    if (role === 'channel') {
      params.set('user_scope', 'search:read');
    }
    if (teamId?.trim()) {
      params.set('team', teamId.trim());
    }
    if (source || role === 'personal') {
      params.set('state', role === 'personal' ? `personal:${source ?? 'settings'}` : source ?? 'settings');
    }

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, appUrl = this.env.appUrl, role: BotRole = 'channel'): Promise<SlackInstallResult> {
    const clientId = this.clientId(role);
    const clientSecret = this.clientSecret(role);
    if (!clientId || !clientSecret) {
      throw new Error('Slack OAuth is not configured');
    }

    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${appUrl}/api/slack/oauth/callback`
      })
    });
    const payload = (await response.json()) as OAuthExchangeResponse;

    if (!payload.ok || !payload.team?.id || !payload.access_token) {
      throw new Error(payload.error ?? 'Slack OAuth exchange failed');
    }

    const appId = payload.app_id ?? this.appId(role);
    const workspace = this.store.saveInstall({
      provider: 'slack',
      externalWorkspaceId: payload.team.id,
      name: payload.team.name ?? payload.team.id,
      botUserId: payload.bot_user_id,
      role,
      appId
    });
    let botInstallation = this.store.getBotInstallation('slack', workspace.externalWorkspaceId, role);
    writeSecret('slack', 'bot_token', payload.access_token, {
      workspaceId: workspace.id,
      externalWorkspaceId: workspace.externalWorkspaceId,
      botInstallationId: botInstallation?.id,
      metadata: {
        teamName: workspace.name,
        botUserId: payload.bot_user_id,
        botRole: role,
        validatedAt: new Date().toISOString()
      }
    });
    if (payload.authed_user?.access_token) {
      writeSecret('slack', 'user_search_token', payload.authed_user.access_token, {
        workspaceId: workspace.id,
        externalWorkspaceId: workspace.externalWorkspaceId,
        userId: payload.authed_user.id,
        metadata: {
          teamName: workspace.name,
          validatedAt: new Date().toISOString()
        }
      });
    }
    reconcileIntegrationCapabilitiesForWorkspace(workspace.id);

    const authedUser = payload.authed_user?.id
      ? await this.getMember(workspace, payload.authed_user.id).catch(() => ({
          id: payload.authed_user!.id!,
          displayName: payload.authed_user!.id!
        }))
      : undefined;

    if (role === 'personal' && authedUser?.id) {
      botInstallation = this.store.upsertBotInstallation({
        workspaceId: workspace.id,
        provider: 'slack',
        role,
        externalWorkspaceId: workspace.externalWorkspaceId,
        botUserId: workspace.botUserId,
        appId,
        representedUserId: authedUser.id
      });
      writeSecret('slack', 'bot_token', payload.access_token, {
        workspaceId: workspace.id,
        externalWorkspaceId: workspace.externalWorkspaceId,
        botInstallationId: botInstallation.id,
        metadata: {
          teamName: workspace.name,
          botUserId: payload.bot_user_id,
          botRole: role,
          representedUserId: authedUser.id,
          validatedAt: new Date().toISOString()
        }
      });
    }

    return { workspace, role, botInstallation, authedUser };
  }

  verifySignature(headers: Headers, rawBody: string, role: BotRole = 'channel'): boolean {
    const signingSecret = this.signingSecret(role);
    if (!signingSecret) {
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
      createHmac('sha256', signingSecret).update(base).digest('hex');

    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  getBotToken(workspaceIdOrTeamId: string, botInstallationId?: string): string {
    const workspace =
      this.store.getWorkspaceById(workspaceIdOrTeamId) ??
      this.store.getWorkspaceByExternalId('slack', workspaceIdOrTeamId) ??
      this.store.getFirstWorkspace();

    const scopedToken = botInstallationId
      ? readSecret('slack', 'bot_token', { botInstallationId })
      : undefined;
    if (scopedToken) {
      return scopedToken;
    }

    const token = workspace
      ? readSecret('slack', 'bot_token', {
          workspaceId: workspace.id,
          externalWorkspaceId: workspace.externalWorkspaceId
        }) ??
        readSecret('slack', 'bot_token', { workspaceId: workspace.id }) ??
        readSecret('slack', 'bot_token', { externalWorkspaceId: workspace.externalWorkspaceId })
      : undefined;
    if (token) {
      return token;
    }

    throw new Error('Slack bot token is missing from local credentials. Reconnect Slack.');
  }

  getBotTokenForRole(workspace: Workspace, role: BotRole): string {
    const installation = this.store.getBotInstallation('slack', workspace.externalWorkspaceId, role);
    if (installation && !this.installationMatchesCurrentApp(installation, role)) {
      throw new Error(`Slack ${role} bot token is tied to a stale app installation. Reconnect Slack.`);
    }
    const scopedToken = installation
      ? readSecret('slack', 'bot_token', { botInstallationId: installation.id })
      : undefined;
    if (scopedToken) {
      return scopedToken;
    }

    const legacyWorkspaceToken = listSecrets()
      .filter((record) => (
        record.provider === 'slack' &&
        record.key === 'bot_token' &&
        !record.botInstallationId &&
        !record.userId &&
        (
          record.workspaceId === workspace.id ||
          record.externalWorkspaceId === workspace.externalWorkspaceId
        )
      ))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.value;
    if (legacyWorkspaceToken) {
      return legacyWorkspaceToken;
    }

    const legacyGlobalToken = readSecret('slack', 'bot_token');
    if (legacyGlobalToken) {
      return legacyGlobalToken;
    }

    throw new Error(`Slack ${role} bot token is missing from local credentials. Reconnect Slack.`);
  }

  canReadBotToken(workspace: Workspace, botInstallationId?: string): boolean {
    try {
      this.getBotToken(workspace.id, botInstallationId);
      return true;
    } catch {
      return false;
    }
  }

  canReadBotInstallationToken(botInstallationId?: string): boolean {
    return Boolean(botInstallationId && readSecret('slack', 'bot_token', { botInstallationId }));
  }

  getUsableWorkspace(): Workspace | undefined {
    const installation = this.store.listBotInstallations({ provider: 'slack' })
      .find((entry) => (
        (entry.role === 'channel' || entry.role === 'personal') &&
        this.installationMatchesCurrentApp(entry, entry.role) &&
        this.canReadBotInstallationToken(entry.id)
      ));
    return installation ? this.store.getWorkspaceById(installation.workspaceId) : undefined;
  }

  hasUnreadableInstall(): boolean {
    return this.store.listWorkspaces().some((workspace) => (
      workspace.provider === 'slack' &&
      !this.canReadBotToken(workspace)
    ));
  }

  getUserSearchToken(workspace: Workspace): string | undefined {
    return readSecret('slack', 'user_search_token', {
      workspaceId: workspace.id,
      externalWorkspaceId: workspace.externalWorkspaceId
    }) ??
      readSecret('slack', 'user_search_token', { workspaceId: workspace.id }) ??
      readSecret('slack', 'user_search_token', { externalWorkspaceId: workspace.externalWorkspaceId });
  }

  async fetchThreadMessages(
    workspace: Workspace,
    thread: ThreadRef
  ): Promise<ChannelMessage[]> {
    const response = await fetch('https://slack.com/api/conversations.replies', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.getBotToken(workspace.id, thread.botInstallationId)}`,
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
    const token = this.getUserSearchToken(workspace);
    if (!token) {
      throw new Error('Slack user search token is missing. Reconnect Slack with search:read user scope.');
    }

    const response = await fetch('https://slack.com/api/search.messages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
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
    await this.postMessage(workspace, thread.channelId, text, thread.threadTs, thread.botInstallationId);
  }

  async postMessage(workspace: Workspace, channelId: string, text: string, threadTs?: string, botInstallationId?: string): Promise<{ ts?: string }> {
    const botToken = botInstallationId
      ? this.getBotToken(workspace.externalWorkspaceId, botInstallationId)
      : this.getBotTokenForRole(workspace, 'channel');
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${botToken}`,
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

  async openDirectMessage(workspace: Workspace, userId: string, botInstallationId?: string): Promise<string> {
    const botToken = botInstallationId
      ? this.getBotToken(workspace.externalWorkspaceId, botInstallationId)
      : this.getBotTokenForRole(workspace, 'personal');
    const response = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${botToken}`,
        'content-type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({ users: userId })
    });
    const payload = (await response.json()) as ConversationsOpenResponse;

    if (!payload.ok || !payload.channel?.id) {
      throw new Error(payload.error ?? 'Failed to open Slack direct message');
    }

    return payload.channel.id;
  }

  async getChannelInfo(workspace: Workspace, channelId: string): Promise<SlackChannelInfo> {
    const response = await fetch('https://slack.com/api/conversations.info', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.getBotTokenForRole(workspace, 'channel')}`,
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

  async getMember(workspace: Workspace, userId: string): Promise<SlackMember> {
    const response = await fetch('https://slack.com/api/users.info', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.getBotToken(workspace.externalWorkspaceId)}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ user: userId })
    });
    const payload = (await response.json()) as UsersInfoResponse;

    if (!payload.ok || !payload.user?.id) {
      throw new Error(payload.error ?? 'Failed to fetch Slack member');
    }

    const user = payload.user;
    return {
      id: user.id,
      displayName: user.profile?.display_name || user.profile?.real_name || user.real_name || user.name || user.id,
      avatar: user.profile?.image_48
    };
  }

  async listChannels(workspace: Workspace): Promise<SlackChannelChoice[]> {
    const response = await fetch('https://slack.com/api/conversations.list', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.getBotTokenForRole(workspace, 'channel')}`,
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
        authorization: `Bearer ${this.getBotTokenForRole(workspace, 'channel')}`,
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
