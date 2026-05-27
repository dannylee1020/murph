import { beforeEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn();
const on = vi.fn();
const socketConstructor = vi.fn(function SocketModeClientMock() {
  return { on, start };
});
const handleSlackEventEnvelope = vi.fn();
const getUsableWorkspace = vi.fn();
const appToken = vi.fn((role = 'channel') => (
  role === 'personal'
    ? process.env.SLACK_PERSONAL_APP_TOKEN
    : process.env.SLACK_CHANNEL_APP_TOKEN || process.env.SLACK_APP_TOKEN
));

vi.mock('@slack/socket-mode', () => ({
  LogLevel: { WARN: 'warn' },
  SocketModeClient: socketConstructor
}));

vi.mock('#lib/server/channels/slack/events', () => ({
  handleSlackEventEnvelope
}));

vi.mock('#lib/server/channels/slack/service', () => ({
  getSlackService: () => ({ getUsableWorkspace, appToken })
}));

describe('SlackSocketModeClient', () => {
  beforeEach(() => {
    vi.resetModules();
    socketConstructor.mockClear();
    on.mockClear();
    start.mockReset();
    start.mockResolvedValue({});
    handleSlackEventEnvelope.mockReset();
    getUsableWorkspace.mockReset();
    getUsableWorkspace.mockReturnValue(undefined);
    appToken.mockClear();
    process.env.SLACK_APP_TOKEN = '';
    delete process.env.SLACK_EVENTS_MODE;
  });

  it('does not start without a Slack app token', async () => {
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
        source: 'socket',
        botRole: 'channel'
      }
    );
  });
});
