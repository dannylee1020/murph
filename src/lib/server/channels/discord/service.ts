import { getRuntimeEnv } from '#lib/server/util/env';
import { getStore } from '#lib/server/persistence/store';
import { readSecret, writeSecret } from '#lib/server/credentials/local-store';
import { reconcileIntegrationCapabilitiesForWorkspace } from '#lib/server/integrations/capabilities';
import { readMurphConfig } from '#lib/server/setup/config-file';
import type { BotInstallation, BotRole, ChannelMessage, ChannelThreadRef, Workspace } from '#lib/types';

export const DISCORD_BOT_PERMISSIONS = '274877991936';
export const DISCORD_REQUIRED_LIMITED_INTENT_FLAGS = {
  MESSAGE_CONTENT: 1 << 19
} as const;

interface DiscordTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
}

interface DiscordGuild {
  id: string;
  name: string;
}

interface DiscordApplication {
  id: string;
  name?: string;
  flags?: number;
  redirect_uris?: string[];
}

interface DiscordUser {
  id: string;
  username?: string;
  global_name?: string | null;
  bot?: boolean;
}

interface DiscordGuildMember {
  user?: DiscordUser;
  nick?: string | null;
}

interface DiscordChannel {
  id: string;
  name?: string;
  type?: number;
  guild_id?: string;
}

interface DiscordMessage {
  id: string;
  content?: string;
  timestamp?: string;
  author?: { id?: string; username?: string };
  message_reference?: { message_id?: string };
}

export interface DiscordSearchResult {
  id: string;
  channelId: string;
  threadTs: string;
  text: string;
  permalink?: string;
  userId?: string;
  threadChannelId?: string;
  rootMessageId?: string;
}

export interface DiscordSearchResponse {
  results: DiscordSearchResult[];
  pendingIndex?: boolean;
  retryAfterSeconds?: number;
}

export interface DiscordBotConfig {
  botUserId: string;
  botUsername?: string;
  botName?: string;
  applicationId: string;
  applicationName?: string;
  applicationFlags?: number;
  applicationRedirectUris?: string[];
}

export interface DiscordChannelChoice {
  id: string;
  displayName: string;
  isPrivate: boolean;
  isMember: boolean;
}

export interface DiscordMemberChoice {
  id: string;
  displayName: string;
}

export interface DiscordGuildChoice {
  id: string;
  name: string;
}

export interface DiscordAppConfigurationResult {
  permissionsConfigured: boolean;
  intentsConfigured: boolean;
  error?: string;
}

export interface DiscordInstallResult {
  workspace: Workspace;
  role: BotRole;
  botInstallation?: BotInstallation;
  authedUser?: DiscordMemberChoice;
}

export class DiscordService {
  private get store() {
    return getStore();
  }

  private get env() {
    return getRuntimeEnv();
  }

  private clientId(role: BotRole): string | undefined {
    const config = readMurphConfig();
    return role === 'personal'
      ? process.env.DISCORD_PERSONAL_CLIENT_ID ?? config.channels?.discord?.bots?.personal?.clientId
      : process.env.DISCORD_CHANNEL_CLIENT_ID ?? config.channels?.discord?.bots?.channel?.clientId ?? this.env.discordClientId;
  }

  private clientSecret(role: BotRole): string | undefined {
    return role === 'personal'
      ? process.env.DISCORD_PERSONAL_CLIENT_SECRET ?? readSecret('discord', 'personal_client_secret')
      : process.env.DISCORD_CHANNEL_CLIENT_SECRET ?? readSecret('discord', 'channel_client_secret') ?? this.env.discordClientSecret;
  }

  botToken(role: BotRole = 'channel', botInstallationId?: string): string | undefined {
    if (botInstallationId) {
      const scoped = readSecret('discord', 'bot_token', { botInstallationId });
      if (scoped) return scoped;
    }
    return role === 'personal'
      ? process.env.DISCORD_PERSONAL_BOT_TOKEN ?? readSecret('discord', 'personal_bot_token')
      : process.env.DISCORD_CHANNEL_BOT_TOKEN ?? readSecret('discord', 'channel_bot_token') ?? this.findBotToken();
  }

  canReadBotInstallationToken(role: BotRole = 'channel', installation?: BotInstallation): boolean {
    if (installation?.id && readSecret('discord', 'bot_token', { botInstallationId: installation.id })) {
      return true;
    }

    if (role === 'personal') {
      return Boolean(process.env.DISCORD_PERSONAL_BOT_TOKEN ?? readSecret('discord', 'personal_bot_token'));
    }

    if (process.env.DISCORD_CHANNEL_BOT_TOKEN ?? readSecret('discord', 'channel_bot_token')) {
      return true;
    }

    if (!installation) {
      return Boolean(this.findBotToken());
    }

    return Boolean(
      readSecret('discord', 'bot_token', {
        workspaceId: installation.workspaceId,
        externalWorkspaceId: installation.externalWorkspaceId
      }) ??
        readSecret('discord', 'bot_token', { workspaceId: installation.workspaceId }) ??
        readSecret('discord', 'bot_token', { externalWorkspaceId: installation.externalWorkspaceId }) ??
        readSecret('discord', 'bot_token')
    );
  }

  isRoleConfigured(role: BotRole = 'channel'): boolean {
    return Boolean(this.botToken(role) && this.clientId(role) && this.clientSecret(role));
  }

  isConfigured(): boolean {
    return Boolean(this.botToken('channel') || this.botToken('personal'));
  }

  buildInstallUrl(options: { appUrl?: string; clientId?: string; source?: string; role?: BotRole } = {}): string | undefined {
    const role = options.role ?? 'channel';
    const clientId = options.clientId ?? this.clientId(role);
    if (!clientId) {
      return undefined;
    }

    const redirectUri = this.resolveRedirectUri(options.appUrl);
    const params = new URLSearchParams({
      client_id: clientId,
      scope: role === 'personal' ? 'identify' : 'bot identify',
      response_type: 'code',
      redirect_uri: redirectUri
    });
    if (role === 'channel') {
      params.set('permissions', DISCORD_BOT_PERMISSIONS);
    }
    if (options.source) {
      params.set('state', options.source);
    }
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  }

  async validateBotToken(botToken?: string): Promise<DiscordBotConfig> {
    const [botUser, application] = await Promise.all([
      this.fetchBotUser(botToken),
      this.fetchCurrentApplication(botToken).catch(() => undefined)
    ]);
    const botName = botUser.global_name ?? botUser.username ?? botUser.id;
    return {
      botUserId: botUser.id,
      botUsername: botName,
      botName,
      applicationId: application?.id ?? botUser.id,
      applicationName: application?.name,
      applicationFlags: application?.flags,
      applicationRedirectUris: discordRedirectUris(application)
    };
  }

  async configureInstallParams(): Promise<boolean> {
    const result = await this.configureApplication();
    return result.permissionsConfigured;
  }

  async configureApplication(botToken?: string): Promise<DiscordAppConfigurationResult> {
    const application = await this.fetchCurrentApplication(botToken).catch(() => undefined);
    const flags = typeof application?.flags === 'number'
      ? application.flags |
        DISCORD_REQUIRED_LIMITED_INTENT_FLAGS.MESSAGE_CONTENT
      : undefined;

    try {
      const response = await fetch('https://discord.com/api/v10/applications/@me', {
        method: 'PATCH',
        headers: {
          authorization: `Bot ${botToken ?? this.getBotToken()}`,
          'content-type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          install_params: {
            scopes: ['bot'],
            permissions: DISCORD_BOT_PERMISSIONS
          },
          integration_types_config: {
            0: {
              oauth2_install_params: {
                scopes: ['bot'],
                permissions: DISCORD_BOT_PERMISSIONS
              }
            }
          },
          ...(flags === undefined ? {} : { flags })
        })
      });
      return {
        permissionsConfigured: response.ok,
        intentsConfigured: response.ok && flags !== undefined,
        ...(response.ok ? {} : { error: await discordErrorMessage(response, 'Discord app configuration automation failed') })
      };
    } catch (error) {
      return {
        permissionsConfigured: false,
        intentsConfigured: false,
        error: error instanceof Error ? error.message : 'Discord app configuration automation failed'
      };
    }
  }

  async exchangeCode(code: string, guildId: string | undefined, redirectUri = this.resolveRedirectUri(), role: BotRole = 'channel'): Promise<DiscordInstallResult> {
    const clientId = this.clientId(role);
    const clientSecret = this.clientSecret(role);
    if (!clientId || !clientSecret) {
      throw new Error('Discord OAuth is not configured');
    }
    if (role === 'channel' && !guildId) {
      throw new Error('Discord OAuth callback is missing guild_id');
    }

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Discord OAuth exchange failed');
    }

    const tokenPayload = await tokenResponse.json() as DiscordTokenResponse;
    if (!tokenPayload.access_token) {
      throw new Error('Discord OAuth exchange did not return an access token');
    }

    const oauthUser = await this.fetchCurrentUser(tokenPayload.access_token);
    const fallbackMember = {
      id: oauthUser.id,
      displayName: oauthUser.global_name ?? oauthUser.username ?? oauthUser.id
    };

    if (role === 'personal') {
      const workspace = this.store.saveInstall({
        provider: 'discord',
        externalWorkspaceId: `personal:${oauthUser.id}`,
        name: fallbackMember.displayName,
        botUserId: await this.fetchBotUserId(role).catch(() => undefined),
        role,
        representedUserId: oauthUser.id
      });
      const botInstallation = this.store.getBotInstallation('discord', workspace.externalWorkspaceId, role);
      const token = this.botToken(role);
      if (token) {
        writeSecret('discord', 'bot_token', token, {
          workspaceId: workspace.id,
          externalWorkspaceId: workspace.externalWorkspaceId,
          botInstallationId: botInstallation?.id,
          metadata: {
            botRole: role,
            representedUserId: oauthUser.id,
            validatedAt: new Date().toISOString()
          }
        });
      }
      reconcileIntegrationCapabilitiesForWorkspace(workspace.id);
      return { workspace, role, botInstallation, authedUser: fallbackMember };
    }

    const guildResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: {
        authorization: `Bot ${this.getBotToken('channel')}`
      }
    });

    if (!guildResponse.ok) {
      throw new Error('Failed to fetch Discord guild');
    }

    const guild = (await guildResponse.json()) as DiscordGuild;
    const workspace = await this.saveGuildWorkspace(guild, 'channel');
    const member = await this.getMember(workspace, oauthUser.id).catch(() => fallbackMember);
    return {
      workspace,
      role,
      botInstallation: this.store.getBotInstallation('discord', workspace.externalWorkspaceId, 'channel'),
      authedUser: member
    };
  }

  private resolveRedirectUri(appUrl = this.env.appUrl): string {
    return this.env.discordRedirectUri ?? `${appUrl}/api/discord/oauth/callback`;
  }

  getBotToken(role: BotRole = 'channel', botInstallationId?: string): string {
    const token = this.botToken(role, botInstallationId);
    if (token) {
      return token;
    }

    throw new Error('Discord bot token is missing from local credentials. Reconnect Discord.');
  }

  private findBotToken(): string | undefined {
    if (this.env.discordBotToken) {
      return this.env.discordBotToken;
    }

    for (const workspace of this.store.listWorkspaces().filter((entry) => entry.provider === 'discord')) {
      const token = readSecret('discord', 'bot_token', {
        workspaceId: workspace.id,
        externalWorkspaceId: workspace.externalWorkspaceId
      }) ??
        readSecret('discord', 'bot_token', { workspaceId: workspace.id }) ??
        readSecret('discord', 'bot_token', { externalWorkspaceId: workspace.externalWorkspaceId });
      if (token) {
        return token;
      }
    }

    const globalToken = readSecret('discord', 'bot_token');
    if (globalToken) {
      return globalToken;
    }

    return undefined;
  }

  async saveGuildWorkspace(guild: DiscordGuild, role: BotRole = 'channel'): Promise<Workspace> {
    const workspace = this.store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: guild.id,
      name: guild.name ?? guild.id,
      botUserId: await this.fetchBotUserId(role),
      role
    });
    const botInstallation = this.store.getBotInstallation('discord', workspace.externalWorkspaceId, role);
    const token = this.botToken(role);
    if (token) {
      writeSecret('discord', 'bot_token', token, {
        workspaceId: workspace.id,
        externalWorkspaceId: workspace.externalWorkspaceId,
        botInstallationId: botInstallation?.id,
        metadata: {
          guildName: workspace.name,
          botUserId: workspace.botUserId,
          botRole: role,
          validatedAt: new Date().toISOString()
        }
      });
    }
    reconcileIntegrationCapabilitiesForWorkspace(workspace.id);
    return workspace;
  }

  async fetchGuild(guildId: string): Promise<DiscordGuild> {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { authorization: `Bot ${this.getBotToken()}` }
    });
    if (!response.ok) {
      throw new Error('Failed to fetch Discord guild');
    }
    return (await response.json()) as DiscordGuild;
  }

  async listCurrentGuilds(): Promise<DiscordGuildChoice[]> {
    const response = await fetch('https://discord.com/api/v10/users/@me/guilds?limit=200', {
      headers: { authorization: `Bot ${this.getBotToken()}` }
    });
    if (!response.ok) {
      throw new Error('Failed to fetch Discord bot guilds');
    }
    const guilds = (await response.json()) as Array<{ id?: string; name?: string }>;
    return guilds
      .filter((guild): guild is { id: string; name?: string } => Boolean(guild.id))
      .map((guild) => ({
        id: guild.id,
        name: guild.name?.trim() || guild.id
      }));
  }

  private async fetchBotUser(botToken?: string): Promise<DiscordUser> {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bot ${botToken ?? this.getBotToken()}` }
    });
    if (!response.ok) {
      throw new Error('Discord bot token validation failed');
    }
    return (await response.json()) as DiscordUser;
  }

  private async fetchCurrentApplication(botToken?: string): Promise<DiscordApplication> {
    const response = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
      headers: { authorization: `Bot ${botToken ?? this.getBotToken()}` }
    });
    if (!response.ok) {
      throw new Error('Failed to fetch Discord application');
    }
    return (await response.json()) as DiscordApplication;
  }

  private async fetchCurrentUser(accessToken: string): Promise<DiscordUser> {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) {
      throw new Error('Failed to fetch Discord OAuth user');
    }
    return (await response.json()) as DiscordUser;
  }

  private async fetchBotUserId(role: BotRole = 'channel'): Promise<string | undefined> {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bot ${this.getBotToken(role)}` }
    });
    if (!response.ok) {
      return undefined;
    }
    const payload = (await response.json()) as { id?: string };
    return payload.id;
  }

  async listChannels(workspace: Workspace): Promise<DiscordChannelChoice[]> {
    const response = await fetch(`https://discord.com/api/v10/guilds/${workspace.externalWorkspaceId}/channels`, {
      headers: { authorization: `Bot ${this.getBotToken()}` }
    });
    if (!response.ok) {
      throw new Error(await discordErrorMessage(response, 'Failed to fetch Discord channels'));
    }
    const channels = (await response.json()) as DiscordChannel[];
    return channels
      .map((channel) => toChannelChoice(channel))
      .filter((channel): channel is DiscordChannelChoice => Boolean(channel));
  }

  async getChannel(workspace: Workspace, channelId: string): Promise<DiscordChannelChoice> {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}`,
      {
        headers: { authorization: `Bot ${this.getBotToken()}` }
      }
    );
    if (!response.ok) {
      throw new Error(await discordErrorMessage(response, 'Failed to fetch Discord channel'));
    }
    const channel = (await response.json()) as DiscordChannel;
    if (channel.guild_id && channel.guild_id !== workspace.externalWorkspaceId) {
      throw new Error('Discord channel does not belong to the selected server');
    }
    const choice = toChannelChoice(channel);
    if (!choice) {
      throw new Error('Discord channel is not a supported text channel');
    }
    return choice;
  }

  async listMembers(workspace: Workspace): Promise<DiscordMemberChoice[]> {
    const response = await fetch(`https://discord.com/api/v10/guilds/${workspace.externalWorkspaceId}/members?limit=1000`, {
      headers: { authorization: `Bot ${this.getBotToken()}` }
    });
    if (!response.ok) {
      throw new Error(await discordErrorMessage(response, 'Failed to fetch Discord members'));
    }
    const members = (await response.json()) as DiscordGuildMember[];
    return members
      .map((member) => toMemberChoice(member))
      .filter((member): member is DiscordMemberChoice => Boolean(member));
  }

  async getMember(workspace: Workspace, userId: string): Promise<DiscordMemberChoice> {
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${workspace.externalWorkspaceId}/members/${encodeURIComponent(userId)}`,
      {
        headers: { authorization: `Bot ${this.getBotToken()}` }
      }
    );
    if (!response.ok) {
      throw new Error(await discordErrorMessage(response, 'Failed to fetch Discord member'));
    }
    const member = toMemberChoice((await response.json()) as DiscordGuildMember);
    if (!member) {
      throw new Error('Discord member response did not include a user ID');
    }
    return member;
  }

  async fetchThreadMessages(_workspace: Workspace, thread: ChannelThreadRef): Promise<ChannelMessage[]> {
    const messages = thread.threadChannelId
      ? await this.fetchChannelMessages(thread.threadChannelId, 50, undefined, thread)
      : await this.fetchChannelMessages(thread.channelId, 50, thread.rootMessageId ? { around: thread.rootMessageId } : undefined, thread);

    return messages
      .filter((message) => {
        if (thread.threadChannelId) {
          return true;
        }
        if (!thread.rootMessageId) {
          return true;
        }
        return message.id === thread.rootMessageId || message.message_reference?.message_id === thread.rootMessageId;
      })
      .map((message) => ({
        provider: 'discord',
        userId: message.author?.id,
        authorId: message.author?.id,
        text: message.content ?? '',
        ts: message.timestamp ?? message.id,
        messageId: message.id,
        createdAt: message.timestamp
      }));
  }

  async postReply(_workspace: Workspace, thread: ChannelThreadRef, text: string): Promise<void> {
    const channelId = thread.threadChannelId ?? thread.channelId;
    const body: Record<string, unknown> = { content: text };
    if (!thread.threadChannelId && thread.rootMessageId) {
      body.message_reference = { message_id: thread.rootMessageId, channel_id: thread.channelId };
    }
    await this.createMessage(channelId, body, thread);
  }

  async postMessage(_workspace: Workspace, channelId: string, text: string): Promise<{ ts?: string }> {
    const payload = await this.createMessage(channelId, { content: text });
    return { ts: payload.id };
  }

  async searchMessages(workspace: Workspace, query: string, limit = 5): Promise<DiscordSearchResponse> {
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${workspace.externalWorkspaceId}/messages/search?${new URLSearchParams({
        content: query,
        include_nsfw: 'true'
      }).toString()}`,
      {
        headers: { authorization: `Bot ${this.getBotToken()}` }
      }
    );

    if (response.status === 202) {
      const payload = (await response.json()) as { retry_after?: number };
      return {
        results: [],
        pendingIndex: true,
        retryAfterSeconds: payload.retry_after
      };
    }

    if (!response.ok) {
      throw new Error('Failed to search Discord messages');
    }

    const payload = (await response.json()) as {
      messages?: DiscordMessage[][];
      threads?: Array<{ id?: string; parent_id?: string }>;
    };
    const threadsById = new Map((payload.threads ?? []).map((thread) => [thread.id, thread.parent_id]));

    const results = (payload.messages ?? [])
      .flat()
      .filter((message) => message.id)
      .slice(0, limit)
      .map((message) => {
        const threadChannelId = threadsById.has(message.id) ? message.id : undefined;
        return {
          id: `discord:${message.id}`,
          channelId: threadChannelId ? threadsById.get(threadChannelId)! : workspace.externalWorkspaceId,
          threadTs: threadChannelId ?? message.id,
          text: message.content ?? '',
          permalink: undefined,
          userId: message.author?.id,
          threadChannelId,
          rootMessageId: threadChannelId ? undefined : message.id
        };
      });

    return { results };
  }

  private async fetchChannelMessages(
    channelId: string,
    limit: number,
    extra?: { around?: string },
    thread?: ChannelThreadRef
  ): Promise<DiscordMessage[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (extra?.around) {
      params.set('around', extra.around);
    }
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?${params.toString()}`, {
      headers: { authorization: `Bot ${this.getBotToken(thread?.botRole ?? 'channel', thread?.botInstallationId)}` }
    });
    if (!response.ok) {
      throw new Error('Failed to fetch Discord channel messages');
    }
    return (await response.json()) as DiscordMessage[];
  }

  private async createMessage(channelId: string, body: Record<string, unknown>, thread?: ChannelThreadRef): Promise<{ id?: string }> {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bot ${this.getBotToken(thread?.botRole ?? 'channel', thread?.botInstallationId)}`,
        'content-type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(await discordErrorMessage(response, 'Failed to post Discord message'));
    }
    return (await response.json()) as { id?: string };
  }
}

let service: DiscordService | null = null;

export function getDiscordService(): DiscordService {
  if (!service) {
    service = new DiscordService();
  }
  return service;
}

async function discordErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => undefined) as { message?: string; error?: string } | undefined;
  const detail = payload?.message ?? payload?.error;
  return detail ? `${fallback}: ${detail}` : `${fallback} (${response.status})`;
}

function discordRedirectUris(application?: DiscordApplication): string[] | undefined {
  return Array.isArray(application?.redirect_uris)
    ? application.redirect_uris
        .filter((uri): uri is string => typeof uri === 'string' && Boolean(uri.trim()))
        .map((uri) => uri.trim())
    : undefined;
}

function toMemberChoice(member: DiscordGuildMember): DiscordMemberChoice | undefined {
  const user = member.user;
  if (!user?.id || user.bot) return undefined;
  return {
    id: user.id,
    displayName: member.nick ?? user.global_name ?? user.username ?? user.id
  };
}

function toChannelChoice(channel: DiscordChannel): DiscordChannelChoice | undefined {
  const textLikeTypes = new Set([0, 5, 15]);
  if (!channel.id || !textLikeTypes.has(channel.type ?? -1)) {
    return undefined;
  }
  return {
    id: channel.id,
    displayName: channel.name ? `#${channel.name}` : channel.id,
    isPrivate: false,
    isMember: true
  };
}
