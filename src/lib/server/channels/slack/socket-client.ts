import { LogLevel, SocketModeClient } from '@slack/socket-mode';
import { getRuntimeEnv } from '#lib/server/util/env';
import { handleSlackEventEnvelope } from '#lib/server/channels/slack/events';

interface SlackSocketEventEnvelope {
  ack?: () => Promise<void>;
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
  private client: SocketModeClient | null = null;
  private started = false;
  private restartTimer: NodeJS.Timeout | null = null;

  isConfigured(): boolean {
    const env = getRuntimeEnv();
    return env.slackEventsMode !== 'http' && Boolean(env.slackAppToken);
  }

  ensureStarted(): void {
    const env = getRuntimeEnv();

    if (this.started || env.slackEventsMode === 'http') {
      return;
    }

    if (!env.slackAppToken) {
      return;
    }

    this.started = true;
    this.client = new SocketModeClient({
      appToken: env.slackAppToken,
      logLevel: LogLevel.WARN
    });
    this.patchSocketModeDisconnectRace(this.client);

    this.client.on('slack_event', (envelope: SlackSocketEventEnvelope) => {
      void this.handleEnvelope(envelope);
    });
    this.client.on('connected', () => {
      if (this.restartTimer) {
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }
      console.info('[slack] socket mode connected');
    });
    this.client.on('disconnected', (error?: unknown) => {
      this.started = false;
      if (error) {
        console.warn('[slack] socket mode disconnected:', error instanceof Error ? error.message : error);
      }
    });
    this.client.on('error', (error) => {
      console.warn('[slack] socket mode error:', error instanceof Error ? error.message : error);
    });
    this.client.on('unable_to_socket_mode_start', (error) => {
      console.warn('[slack] socket mode could not start:', error instanceof Error ? error.message : error);
    });

    void this.client.start().catch((error) => {
      this.started = false;
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
    try {
      await envelope.ack?.();
    } catch (error) {
      console.warn('[slack] socket mode ack failed:', error instanceof Error ? error.message : error);
    }

    if (envelope.type !== 'events_api' || !envelope.body) {
      return;
    }

    await handleSlackEventEnvelope(envelope.body, {
      envelopeId: envelope.envelope_id,
      rawPayload: JSON.stringify(envelope.body),
      source: 'socket'
    });
  }
}

let client: SlackSocketModeClient | null = null;

export function getSlackSocketModeClient(): SlackSocketModeClient {
  if (!client) {
    client = new SlackSocketModeClient();
  }
  return client;
}
