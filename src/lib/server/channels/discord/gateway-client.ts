import WebSocket from 'ws';
import { getDiscordService } from '#lib/server/channels/discord/service';
import { getGateway } from '#lib/server/runtime/gateway';
import { getStore } from '#lib/server/persistence/store';
import { normalizeDiscordEventWithReason } from '#lib/server/channels/discord/adapter';
import {
  markIngressClosed,
  markIngressConfigured,
  markIngressConnected,
  markIngressError,
  markIngressEvent,
  markIngressIgnored,
  markIngressStarting
} from '#lib/server/channels/ingress-health';

const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15);

export class DiscordGatewayClient {
  private socket: WebSocket | null = null;
  private heartbeatHandle: NodeJS.Timeout | null = null;
  private sequence: number | null = null;
  private started = false;

  ensureStarted(): void {
    const hasDiscordWorkspace = getStore().listWorkspaces().some((workspace) => workspace.provider === 'discord');
    if (this.started || !hasDiscordWorkspace || !getDiscordService().isConfigured()) {
      markIngressConfigured('discord', hasDiscordWorkspace && getDiscordService().isConfigured());
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
          token: getDiscordService().getBotToken(),
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
      await this.saveReadyGuilds(payload.d as Record<string, unknown>);
      return;
    }

    if (payload.op === 0 && payload.t === 'GUILD_CREATE' && payload.d) {
      await this.saveGuild(payload.d as Record<string, unknown>);
      return;
    }

    if (payload.op !== 0 || payload.t !== 'MESSAGE_CREATE' || !payload.d) {
      return;
    }

    markIngressEvent('discord');
    const guildId = typeof payload.d.guild_id === 'string' ? payload.d.guild_id : undefined;
    const normalized = normalizeDiscordEventWithReason(payload.d as Record<string, unknown>, {
      eventId: typeof payload.d.id === 'string' ? payload.d.id : undefined,
      teamId: guildId
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
      await getDiscordService().saveGuildWorkspace(guild);
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

let client: DiscordGatewayClient | null = null;

export function getDiscordGatewayClient(): DiscordGatewayClient {
  if (!client) {
    client = new DiscordGatewayClient();
  }
  return client;
}
