import { decryptString, encryptString } from '#lib/server/util/crypto';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getStore } from '#lib/server/persistence/store';
import type { ChannelMessage, ChannelThreadRef, Workspace } from '#lib/types';

interface DiscordTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
}

interface DiscordGuild {
  id: string;
  name: string;
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

export class DiscordService {
  private readonly env = getRuntimeEnv();
  private readonly store = getStore();

  isConfigured(): boolean {
    return Boolean(this.env.discordBotToken && this.env.discordClientId && this.env.discordClientSecret);
  }

  buildInstallUrl(): string | undefined {
    if (!this.env.discordClientId || !this.env.discordRedirectUri) {
      return undefined;
    }

    const params = new URLSearchParams({
      client_id: this.env.discordClientId,
      redirect_uri: this.env.discordRedirectUri,
      response_type: 'code',
      scope: 'identify guilds bot',
      permissions: '274877991936'
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, guildId?: string): Promise<Workspace> {
    if (!this.env.discordClientId || !this.env.discordClientSecret || !this.env.discordRedirectUri) {
      throw new Error('Discord OAuth is not configured');
    }
    if (!guildId) {
      throw new Error('Discord OAuth callback is missing guild_id');
    }

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.discordClientId,
        client_secret: this.env.discordClientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.env.discordRedirectUri
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Discord OAuth exchange failed');
    }

    await tokenResponse.json() as DiscordTokenResponse;

    const guildResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: {
        authorization: `Bot ${this.getBotToken()}`
      }
    });

    if (!guildResponse.ok) {
      throw new Error('Failed to fetch Discord guild');
    }

    const guild = (await guildResponse.json()) as DiscordGuild;
    return this.store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: guild.id,
      name: guild.name ?? guild.id,
      botTokenEncrypted: this.encryptBotTokenForStorage(),
      botUserId: await this.fetchBotUserId()
    });
  }

  private encryptBotTokenForStorage(): string {
    if (!this.env.discordBotToken) {
      throw new Error('DISCORD_BOT_TOKEN is not configured');
    }
    if (!this.env.encryptionKey) {
      return this.env.discordBotToken;
    }
    return encryptString(this.env.discordBotToken, this.env.encryptionKey);
  }

  getBotToken(): string {
    if (this.env.discordBotToken) {
      return this.env.discordBotToken;
    }

    const workspace = this.store.getWorkspaceByExternalId('discord', this.store.getFirstWorkspace()?.externalWorkspaceId ?? '');
    if (!workspace?.botTokenEncrypted) {
      throw new Error('No Discord bot token configured');
    }
    if (!this.env.encryptionKey) {
      return workspace.botTokenEncrypted;
    }
    return decryptString(workspace.botTokenEncrypted, this.env.encryptionKey);
  }

  private async fetchBotUserId(): Promise<string | undefined> {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bot ${this.getBotToken()}` }
    });
    if (!response.ok) {
      return undefined;
    }
    const payload = (await response.json()) as { id?: string };
    return payload.id;
  }

  async fetchThreadMessages(_workspace: Workspace, thread: ChannelThreadRef): Promise<ChannelMessage[]> {
    const messages = thread.threadChannelId
      ? await this.fetchChannelMessages(thread.threadChannelId, 50)
      : await this.fetchChannelMessages(thread.channelId, 50, thread.rootMessageId ? { around: thread.rootMessageId } : undefined);

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
    await this.createMessage(channelId, body);
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
    extra?: { around?: string }
  ): Promise<DiscordMessage[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (extra?.around) {
      params.set('around', extra.around);
    }
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?${params.toString()}`, {
      headers: { authorization: `Bot ${this.getBotToken()}` }
    });
    if (!response.ok) {
      throw new Error('Failed to fetch Discord channel messages');
    }
    return (await response.json()) as DiscordMessage[];
  }

  private async createMessage(channelId: string, body: Record<string, unknown>): Promise<{ id?: string }> {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bot ${this.getBotToken()}`,
        'content-type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error('Failed to post Discord message');
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
