import WebSocket from 'ws';
import { getDiscordService } from '#lib/server/channels/discord/service';
import { getGateway } from '#lib/server/runtime/gateway';
import { getStore } from '#lib/server/persistence/store';
import { normalizeDiscordEvent } from '#lib/server/channels/discord/adapter';

const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15);

export class DiscordGatewayClient {
  private socket: WebSocket | null = null;
  private heartbeatHandle: NodeJS.Timeout | null = null;
  private sequence: number | null = null;
  private started = false;

  ensureStarted(): void {
    if (this.started || !getDiscordService().isConfigured()) {
      return;
    }
    this.started = true;
    this.connect();
  }

  private connect(): void {
    this.socket = new WebSocket(DISCORD_GATEWAY_URL);
    this.socket.on('message', (data) => {
      void this.handlePayload(String(data));
    });
    this.socket.on('close', () => {
      this.cleanupHeartbeat();
      this.socket = null;
      setTimeout(() => this.connect(), 3000);
    });
  }

  private async handlePayload(raw: string): Promise<void> {
    const payload = JSON.parse(raw) as { op: number; d?: any; s?: number | null; t?: string };
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

    if (payload.op !== 0 || payload.t !== 'MESSAGE_CREATE' || !payload.d) {
      return;
    }

    const guildId = typeof payload.d.guild_id === 'string' ? payload.d.guild_id : undefined;
    const task = normalizeDiscordEvent(payload.d as Record<string, unknown>, {
      eventId: typeof payload.d.id === 'string' ? payload.d.id : undefined,
      teamId: guildId
    });
    if (!task) {
      return;
    }

    const store = getStore();
    const workspace = guildId ? store.getWorkspaceByExternalId('discord', guildId) : undefined;
    if (!workspace) {
      return;
    }

    await getGateway().handleTask(task);
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
