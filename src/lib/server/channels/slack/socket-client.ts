import { LogLevel, SocketModeClient } from '@slack/socket-mode';
import { getRuntimeEnv } from '#lib/server/util/env';
import { handleSlackEventEnvelope } from '#lib/server/channels/slack/events';

interface SlackSocketEventEnvelope {
  ack?: () => Promise<void>;
  envelope_id?: string;
  type?: string;
  body?: Record<string, unknown>;
}

export class SlackSocketModeClient {
  private client: SocketModeClient | null = null;
  private started = false;

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

    this.client.on('slack_event', (envelope: SlackSocketEventEnvelope) => {
      void this.handleEnvelope(envelope);
    });
    this.client.on('connected', () => {
      console.info('[slack] socket mode connected');
    });
    this.client.on('disconnected', (error?: unknown) => {
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
