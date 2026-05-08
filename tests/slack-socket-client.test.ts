import { beforeEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn();
const on = vi.fn();
const socketConstructor = vi.fn(function SocketModeClientMock() {
  return { on, start };
});
const handleSlackEventEnvelope = vi.fn();

vi.mock('@slack/socket-mode', () => ({
  LogLevel: { WARN: 'warn' },
  SocketModeClient: socketConstructor
}));

vi.mock('#lib/server/channels/slack/events', () => ({
  handleSlackEventEnvelope
}));

describe('SlackSocketModeClient', () => {
  beforeEach(() => {
    vi.resetModules();
    socketConstructor.mockClear();
    on.mockClear();
    start.mockReset();
    start.mockResolvedValue({});
    handleSlackEventEnvelope.mockReset();
    process.env.SLACK_APP_TOKEN = '';
    delete process.env.SLACK_EVENTS_MODE;
  });

  it('does not start without a Slack app token', async () => {
    const { SlackSocketModeClient } = await import('../src/lib/server/channels/slack/socket-client');

    new SlackSocketModeClient().ensureStarted();

    expect(socketConstructor).not.toHaveBeenCalled();
  });

  it('does not start in legacy HTTP events mode', async () => {
    process.env.SLACK_EVENTS_MODE = 'http';
    process.env.SLACK_APP_TOKEN = 'xapp-test';
    const { SlackSocketModeClient } = await import('../src/lib/server/channels/slack/socket-client');

    new SlackSocketModeClient().ensureStarted();

    expect(socketConstructor).not.toHaveBeenCalled();
  });

  it('starts Socket Mode when configured', async () => {
    process.env.SLACK_APP_TOKEN = 'xapp-test';
    const { SlackSocketModeClient } = await import('../src/lib/server/channels/slack/socket-client');

    new SlackSocketModeClient().ensureStarted();

    expect(socketConstructor).toHaveBeenCalledWith({ appToken: 'xapp-test', logLevel: 'warn' });
    expect(on).toHaveBeenCalledWith('slack_event', expect.any(Function));
    expect(start).toHaveBeenCalledOnce();
  });

  it('acks and handles Slack Events API envelopes', async () => {
    const ack = vi.fn().mockResolvedValue(undefined);
    const { SlackSocketModeClient } = await import('../src/lib/server/channels/slack/socket-client');

    await new SlackSocketModeClient().handleEnvelope({
      ack,
      envelope_id: 'env-1',
      type: 'events_api',
      body: { event_id: 'Ev1', team_id: 'T1', event: { type: 'app_mention' } }
    });

    expect(ack).toHaveBeenCalledOnce();
    expect(handleSlackEventEnvelope).toHaveBeenCalledWith(
      { event_id: 'Ev1', team_id: 'T1', event: { type: 'app_mention' } },
      {
        envelopeId: 'env-1',
        rawPayload: JSON.stringify({ event_id: 'Ev1', team_id: 'T1', event: { type: 'app_mention' } }),
        source: 'socket'
      }
    );
  });
});
