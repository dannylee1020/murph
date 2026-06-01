import WebSocket from 'ws';
import { getDiscordService } from '#shared/server/channels/discord/service';
import { getGateway } from '#shared/server/runtime/gateway';
import { getStore } from '#shared/server/persistence/store';
import { normalizeDiscordEventWithReason } from '#shared/server/channels/discord/adapter';
import { providerBotRoleEnabled } from '#shared/server/setup/bot-roles';
import type { BotRole } from '#shared/types';
import {
  markIngressClosed,
  markIngressConfigured,
  markIngressConnected,
  markIngressError,
  markIngressEvent,
  markIngressIgnored,
  markIngressStarting
} from '#shared/server/channels/ingress-health';

const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
export const DISCORD_GATEWAY_INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15
} as const;
const INTENTS =
  DISCORD_GATEWAY_INTENTS.GUILDS |
  DISCORD_GATEWAY_INTENTS.GUILD_MESSAGES |
  DISCORD_GATEWAY_INTENTS.DIRECT_MESSAGES |
  DISCORD_GATEWAY_INTENTS.MESSAGE_CONTENT;

function discordEventAuthorId(event: Record<string, unknown>): string | undefined {
  return typeof event.author === 'object' &&
    event.author &&
    typeof (event.author as { id?: unknown }).id === 'string'
    ? (event.author as { id: string }).id
    : undefined;
}

function currentDiscordAppId(role: BotRole): string | undefined {
  const config = getStore().getBotAppConfig('discord', role);
  return role === 'personal'
    ? process.env.DISCORD_PERSONAL_CLIENT_ID ?? config?.clientId ?? config?.appId
    : process.env.DISCORD_CHANNEL_CLIENT_ID ?? process.env.DISCORD_CLIENT_ID ?? config?.clientId ?? config?.appId;
}

function isCurrentDiscordInstallation(installation: ReturnType<ReturnType<typeof getStore>['listBotInstallations']>[number], role: BotRole): boolean {
  const appId = currentDiscordAppId(role);
  if (!appId || installation.appId !== appId) return false;
  if (role === 'personal' && !installation.representedUserId) return false;
  return true;
}

export function discordBotInstallationForEvent(
  role: BotRole,
  event: Record<string, unknown>,
  guildId?: string
) {
  const store = getStore();
  if (guildId) {
    const installation = store.getBotInstallation('discord', guildId, role);
    return installation && isCurrentDiscordInstallation(installation, role) ? installation : undefined;
  }
  if (role !== 'personal') {
    return undefined;
  }
  const actorUserId = discordEventAuthorId(event);
  if (!actorUserId) {
    return undefined;
  }
  return store
    .listBotInstallations({ provider: 'discord', role: 'personal' })
    .find((installation) =>
      installation.status === 'active' &&
      isCurrentDiscordInstallation(installation, role) &&
      installation.representedUserId === actorUserId
    );
}

export class DiscordGatewayClient {
  constructor(private readonly role: BotRole = 'channel') {}

  private socket: WebSocket | null = null;
  private heartbeatHandle: NodeJS.Timeout | null = null;
  private sequence: number | null = null;
  private started = false;

  ensureStarted(): void {
    const enabled = providerBotRoleEnabled(getStore().getAppSettings().setupDefaults, 'discord', this.role);
    const hasDiscordWorkspace = getStore()
      .listBotInstallations({ provider: 'discord', role: this.role })
      .some((installation) => installation.status === 'active' && isCurrentDiscordInstallation(installation, this.role));
    const configured = Boolean(getDiscordService().botToken(this.role));
    if (this.started || !enabled || !hasDiscordWorkspace || !configured) {
      markIngressConfigured('discord', enabled && hasDiscordWorkspace && configured);
      return;
    }
    this.started = true;
    markIngressStarting('discord');
    this.connect();
  }

  private connect(): void {
    this.socket = new WebSocket(DISCORD_GATEWAY_URL);
    this.socket.on('message', (data) => {
      void this.handlePayload(String(data));
    });
    this.socket.on('error', (error) => {
      markIngressError('discord', error);
      console.warn('[discord] gateway error:', error instanceof Error ? error.message : error);
    });
    this.socket.on('close', (code, reason) => {
      this.cleanupHeartbeat();
      this.socket = null;
      this.started = false;
      markIngressClosed('discord', code, Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason));
      if ([4004, 4013, 4014].includes(code)) {
        return;
      }
      setTimeout(() => {
        if (this.started) {
          return;
        }
        this.started = true;
        markIngressStarting('discord');
        this.connect();
      }, 3000);
    });
  }

  private async handlePayload(raw: string): Promise<void> {
    let payload: { op: number; d?: any; s?: number | null; t?: string };
    try {
      payload = JSON.parse(raw) as { op: number; d?: any; s?: number | null; t?: string };
    } catch (error) {
      markIngressError('discord', error);
      return;
    }
    if (typeof payload.s === 'number') {
      this.sequence = payload.s;
    }

    if (payload.op === 10) {
      const interval = Number(payload.d?.heartbeat_interval ?? 45000);
      this.cleanupHeartbeat();
      this.heartbeatHandle = setInterval(() => {
        this.send({ op: 1, d: this.sequence });
      }, interval);
      this.send({
        op: 2,
        d: {
          token: getDiscordService().getBotToken(this.role),
          intents: INTENTS,
          properties: {
            os: process.platform,
            browser: 'murph',
            device: 'murph'
          }
        }
      });
      return;
    }

    if (payload.op === 0 && payload.t === 'READY' && payload.d) {
      markIngressConnected('discord');
      if (this.role === 'channel') {
        await this.saveReadyGuilds(payload.d as Record<string, unknown>);
      }
      return;
    }

    if (payload.op === 0 && payload.t === 'GUILD_CREATE' && payload.d) {
      if (this.role === 'channel') {
        await this.saveGuild(payload.d as Record<string, unknown>);
      }
      return;
    }

    if (payload.op !== 0 || payload.t !== 'MESSAGE_CREATE' || !payload.d) {
      return;
    }

    if (!providerBotRoleEnabled(getStore().getAppSettings().setupDefaults, 'discord', this.role)) {
      markIngressIgnored('discord', 'bot_role_disabled');
      console.info('[discord] ignored event', {
        eventId: typeof payload.d.id === 'string' ? payload.d.id : undefined,
        guildId: typeof payload.d.guild_id === 'string' ? payload.d.guild_id : undefined,
        channelId: typeof payload.d.channel_id === 'string' ? payload.d.channel_id : undefined,
        userId: typeof payload.d.author?.id === 'string' ? payload.d.author.id : undefined,
        reason: 'bot_role_disabled',
        botRole: this.role
      });
      return;
    }

    markIngressEvent('discord');
    const guildId = typeof payload.d.guild_id === 'string' ? payload.d.guild_id : undefined;
    const botInstallation = discordBotInstallationForEvent(this.role, payload.d as Record<string, unknown>, guildId);
    const normalized = normalizeDiscordEventWithReason(payload.d as Record<string, unknown>, {
      eventId: typeof payload.d.id === 'string' ? payload.d.id : undefined,
      teamId: guildId,
      botRole: this.role,
      botInstallationId: botInstallation?.id
    });
    if (!normalized.task) {
      markIngressIgnored('discord', normalized.ignoredReason);
      console.info('[discord] ignored event', {
        eventId: typeof payload.d.id === 'string' ? payload.d.id : undefined,
        guildId,
        channelId: typeof payload.d.channel_id === 'string' ? payload.d.channel_id : undefined,
        userId: typeof payload.d.author?.id === 'string' ? payload.d.author.id : undefined,
        reason: normalized.ignoredReason
      });
      return;
    }
    const task = normalized.task;

    const store = getStore();
    const workspace = guildId
      ? store.getWorkspaceByExternalId('discord', guildId)
      : store.getWorkspaceById(task.workspaceId);
    if (!workspace) {
      markIngressIgnored('discord', 'workspace_not_installed');
      return;
    }

    const inserted = store.saveChannelEvent({
      provider: 'discord',
      workspaceId: workspace.id,
      dedupeKey: task.dedupeKey ?? task.id,
      eventType: task.eventType ?? 'MESSAGE_CREATE',
      payloadJson: raw
    });
    if (!inserted) {
      markIngressIgnored('discord', 'duplicate_event');
      return;
    }

    await getGateway().handleTask(task);
  }

  private async saveReadyGuilds(event: Record<string, unknown>): Promise<void> {
    const guilds = Array.isArray(event.guilds) ? event.guilds : [];
    for (const guild of guilds) {
      if (guild && typeof guild === 'object') {
        await this.saveGuild(guild as Record<string, unknown>);
      }
    }
  }

  private async saveGuild(event: Record<string, unknown>): Promise<void> {
    const id = typeof event.id === 'string' ? event.id : undefined;
    if (!id) return;
    const name = typeof event.name === 'string' && event.name.trim()
      ? event.name.trim()
      : undefined;
    try {
      const guild = name
        ? { id, name }
        : await getDiscordService().fetchGuild(id);
      await getDiscordService().saveGuildWorkspace(guild, this.role);
    } catch (error) {
      console.warn('[discord] failed to save guild workspace:', error instanceof Error ? error.message : error);
    }
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private cleanupHeartbeat(): void {
    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
  }
}

const clients = new Map<BotRole, DiscordGatewayClient>();

export function getDiscordGatewayClient(role: BotRole = 'channel'): DiscordGatewayClient {
  const client = clients.get(role);
  if (!client) {
    const next = new DiscordGatewayClient(role);
    clients.set(role, next);
    return next;
  }
  return client;
}
