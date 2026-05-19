import { beforeEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn();
const on = vi.fn();
const disconnect = vi.fn();
const onWebSocketMessage = vi.fn();
const stateMachine = { getCurrentState: vi.fn() };
const socketConstructor = vi.fn(function SocketModeClientMock() {
  return { on, start, disconnect, onWebSocketMessage, stateMachine };
});
const handleSlackEventEnvelope = vi.fn();
const getUsableWorkspace = vi.fn();

vi.mock('@slack/socket-mode', () => ({
  LogLevel: { WARN: 'warn' },
  SocketModeClient: socketConstructor
}));

vi.mock('#lib/server/channels/slack/events', () => ({
  handleSlackEventEnvelope
}));

vi.mock('#lib/server/channels/slack/service', () => ({
  getSlackService: () => ({ getUsableWorkspace })
}));

describe('SlackSocketModeClient', () => {
  beforeEach(() => {
    vi.resetModules();
    socketConstructor.mockClear();
    on.mockClear();
    disconnect.mockReset();
    disconnect.mockResolvedValue(undefined);
    onWebSocketMessage.mockReset();
    onWebSocketMessage.mockResolvedValue(undefined);
    stateMachine.getCurrentState.mockReset();
    stateMachine.getCurrentState.mockReturnValue('disconnected');
    start.mockReset();
    start.mockResolvedValue({});
    handleSlackEventEnvelope.mockReset();
    getUsableWorkspace.mockReset();
    getUsableWorkspace.mockReturnValue(undefined);
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

  it('does not start before the Slack app is installed in a workspace', async () => {
    process.env.SLACK_APP_TOKEN = 'xapp-test';
    const { SlackSocketModeClient } = await import('../src/lib/server/channels/slack/socket-client');

    new SlackSocketModeClient().ensureStarted();

    expect(socketConstructor).not.toHaveBeenCalled();
  });

  it('starts Socket Mode when configured', async () => {
    process.env.SLACK_APP_TOKEN = 'xapp-test';
    getUsableWorkspace.mockReturnValue({ id: 'workspace-1' });
    const { SlackSocketModeClient } = await import('../src/lib/server/channels/slack/socket-client');

    new SlackSocketModeClient().ensureStarted();

    expect(socketConstructor).toHaveBeenCalledWith({ appToken: 'xapp-test', logLevel: 'warn' });
    expect(on).toHaveBeenCalledWith('slack_event', expect.any(Function));
    expect(start).toHaveBeenCalledOnce();
  });

  it('restarts when Slack disconnects while the socket is connecting', async () => {
    vi.useFakeTimers();
    process.env.SLACK_APP_TOKEN = 'xapp-test';
    getUsableWorkspace.mockReturnValue({ id: 'workspace-1' });
    stateMachine.getCurrentState.mockReturnValue('connecting');
    const { SlackSocketModeClient } = await import('../src/lib/server/channels/slack/socket-client');

    new SlackSocketModeClient().ensureStarted();
    const client = socketConstructor.mock.results[0].value;

    await expect(client.onWebSocketMessage({ data: '{"type":"disconnect","reason":"refresh_requested"}' })).resolves.toBeUndefined();
    expect(onWebSocketMessage).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1000);

    expect(socketConstructor).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
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
