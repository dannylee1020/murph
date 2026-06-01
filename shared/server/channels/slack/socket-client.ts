import { LogLevel, SocketModeClient } from '@slack/socket-mode';
import { getStore } from '#shared/server/persistence/store';
import { handleSlackEventEnvelope } from '#shared/server/channels/slack/events';
import {
  handleSlackSocketInteractive,
  handleSlackSocketSlashCommand
} from '#shared/server/channels/slack/interactions';
import { getSlackService } from '#shared/server/channels/slack/service';
import type { BotRole } from '#shared/types';
import {
  markIngressConfigured,
  markIngressConnected,
  markIngressError,
  markIngressEvent,
  markIngressIgnored,
  markIngressStarting,
  updateIngressHealth
} from '#shared/server/channels/ingress-health';

interface SlackSocketEventEnvelope {
  ack?: (response?: { response_type: 'ephemeral'; text: string }) => Promise<void>;
  envelope_id?: string;
  type?: string;
  body?: Record<string, unknown>;
}

function socketMessageText(data: unknown): string | undefined {
  if (typeof data === 'string') {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }

  return undefined;
}

export class SlackSocketModeClient {
  constructor(private readonly role: BotRole = 'channel') {}

  private client: SocketModeClient | null = null;
  private started = false;
  private restartTimer: NodeJS.Timeout | null = null;

  private eventsMode(): 'http' | 'socket' {
    if (process.env.SLACK_EVENTS_MODE === 'http') return 'http';
    if (process.env.SLACK_EVENTS_MODE === 'socket') return 'socket';
    return getStore().getBotAppConfig('slack', this.role)?.eventsMode ?? 'socket';
  }

  isConfigured(): boolean {
    return this.eventsMode() !== 'http' && Boolean(this.appToken());
  }

  private appToken(): string | undefined {
    return getSlackService().appToken(this.role);
  }

  ensureStarted(): void {
    if (this.started || this.eventsMode() === 'http') {
      markIngressConfigured('slack', this.eventsMode() !== 'http' && Boolean(this.appToken()));
      return;
    }

    const appToken = this.appToken();
    if (!appToken) {
      markIngressConfigured('slack', false);
      return;
    }

    if (!getSlackService().getUsableWorkspace()) {
      markIngressConfigured('slack', true);
      return;
    }

    this.started = true;
    markIngressStarting('slack');
    this.client = new SocketModeClient({
      appToken,
      logLevel: LogLevel.WARN
    });
    this.patchSocketModeDisconnectRace(this.client);

    this.client.on('slack_event', (envelope: SlackSocketEventEnvelope) => {
      void this.handleEnvelope(envelope);
    });
    this.client.on('slash_commands', (envelope: SlackSocketEventEnvelope) => {
      void this.handleSlashCommandEnvelope(envelope);
    });
    this.client.on('interactive', (envelope: SlackSocketEventEnvelope) => {
      void this.handleInteractiveEnvelope(envelope);
    });
    this.client.on('connected', () => {
      if (this.restartTimer) {
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }
      markIngressConnected('slack');
      console.info('[slack] socket mode connected');
    });
    this.client.on('disconnected', (error?: unknown) => {
      this.started = false;
      updateIngressHealth('slack', {
        started: false,
        connected: false,
        status: error ? 'error' : 'idle',
        lastError: error ? (error instanceof Error ? error.message : String(error)) : undefined,
        lastErrorAt: error ? new Date().toISOString() : undefined
      });
      if (error) {
        console.warn('[slack] socket mode disconnected:', error instanceof Error ? error.message : error);
      }
    });
    this.client.on('error', (error) => {
      markIngressError('slack', error);
      console.warn('[slack] socket mode error:', error instanceof Error ? error.message : error);
    });
    this.client.on('unable_to_socket_mode_start', (error) => {
      markIngressError('slack', error);
      console.warn('[slack] socket mode could not start:', error instanceof Error ? error.message : error);
    });

    void this.client.start().catch((error) => {
      this.started = false;
      markIngressError('slack', error);
      console.warn('[slack] socket mode start failed:', error instanceof Error ? error.message : error);
    });
  }

  private patchSocketModeDisconnectRace(client: SocketModeClient): void {
    const socketClient = client as SocketModeClient & {
      onWebSocketMessage?: (event: { data: unknown }) => Promise<void>;
    };
    const original = socketClient.onWebSocketMessage;
    if (!original) {
      return;
    }

    socketClient.onWebSocketMessage = async (event) => {
      if (this.isServerDisconnectWhileConnecting(client, event.data)) {
        console.warn('[slack] socket mode disconnected while connecting; restarting');
        this.restartAfterDisconnectRace(client);
        return;
      }

      try {
        await original.call(client, event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Unhandled event 'server explicit disconnect' in state 'connecting'")) {
          console.warn('[slack] socket mode disconnected while connecting; restarting');
          this.restartAfterDisconnectRace(client);
          return;
        }
        throw error;
      }
    };
  }

  private isServerDisconnectWhileConnecting(client: SocketModeClient, data: unknown): boolean {
    const stateMachine = (client as unknown as {
      stateMachine?: { getCurrentState?: () => unknown };
    }).stateMachine;
    const currentState = stateMachine?.getCurrentState?.();

    if (currentState !== 'connecting') {
      return false;
    }

    const text = socketMessageText(data);
    if (!text) {
      return false;
    }

    try {
      const payload = JSON.parse(text) as { type?: unknown };
      return payload.type === 'disconnect';
    } catch {
      return false;
    }
  }

  private restartAfterDisconnectRace(client: SocketModeClient): void {
    if (this.restartTimer) {
      return;
    }

    this.started = false;
    if (this.client === client) {
      this.client = null;
    }

    try {
      void client.disconnect().catch(() => {});
    } catch {
      // The Slack SDK can already be mid-transition when this race is hit.
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.ensureStarted();
    }, 1000);
  }

  async handleEnvelope(envelope: SlackSocketEventEnvelope): Promise<void> {
    if (envelope.type !== 'events_api' || !envelope.body) {
      markIngressIgnored('slack', envelope.type ? `unsupported_envelope:${envelope.type}` : 'missing_envelope_body');
      return;
    }

    try {
      await envelope.ack?.();
    } catch (error) {
      console.warn('[slack] socket mode ack failed:', error instanceof Error ? error.message : error);
    }

    markIngressEvent('slack');
    await handleSlackEventEnvelope(envelope.body, {
      envelopeId: envelope.envelope_id,
      rawPayload: JSON.stringify(envelope.body),
      source: 'socket',
      botRole: this.role
    });
  }

  async handleSlashCommandEnvelope(envelope: SlackSocketEventEnvelope): Promise<void> {
    try {
      markIngressEvent('slack');
      await handleSlackSocketSlashCommand(envelope);
    } catch (error) {
      markIngressError('slack', error);
      console.warn('[slack] socket slash command failed:', error instanceof Error ? error.message : error);
    }
  }

  async handleInteractiveEnvelope(envelope: SlackSocketEventEnvelope): Promise<void> {
    try {
      markIngressEvent('slack');
      await handleSlackSocketInteractive(envelope);
    } catch (error) {
      markIngressError('slack', error);
      console.warn('[slack] socket interaction failed:', error instanceof Error ? error.message : error);
    }
  }
}

const clients = new Map<BotRole, SlackSocketModeClient>();

export function getSlackSocketModeClient(role: BotRole = 'channel'): SlackSocketModeClient {
  const client = clients.get(role);
  if (!client) {
    const next = new SlackSocketModeClient(role);
    clients.set(role, next);
    return next;
  }
  return client;
}
