import { beforeEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn();
const on = vi.fn();
const socketConstructor = vi.fn(function SocketModeClientMock() {
  return { on, start };
});
const handleSlackEventEnvelope = vi.fn();
const handleSlackSocketSlashCommand = vi.fn();
const handleSlackSocketInteractive = vi.fn();
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

vi.mock('#lib/server/channels/slack/interactions', () => ({
  handleSlackSocketSlashCommand,
  handleSlackSocketInteractive
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
    handleSlackSocketSlashCommand.mockReset();
    handleSlackSocketSlashCommand.mockResolvedValue(undefined);
    handleSlackSocketInteractive.mockReset();
    handleSlackSocketInteractive.mockResolvedValue(undefined);
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
    expect(on).toHaveBeenCalledWith('slash_commands', expect.any(Function));
    expect(on).toHaveBeenCalledWith('interactive', expect.any(Function));
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

  it('does not ack non-Events API envelopes from the generic Slack event listener', async () => {
    const ack = vi.fn().mockResolvedValue(undefined);
    const { SlackSocketModeClient } = await import('../src/lib/server/channels/slack/socket-client');

    await new SlackSocketModeClient().handleEnvelope({
      ack,
      envelope_id: 'env-1',
      type: 'slash_commands',
      body: { command: '/murph', user_id: 'U1' }
    });

    expect(ack).not.toHaveBeenCalled();
    expect(handleSlackEventEnvelope).not.toHaveBeenCalled();
  });

  it('handles Socket Mode slash command envelopes with the interaction handler', async () => {
    const ack = vi.fn().mockResolvedValue(undefined);
    const envelope = {
      ack,
      envelope_id: 'env-1',
      body: { command: '/murph', user_id: 'U1' }
    };
    const { SlackSocketModeClient } = await import('../src/lib/server/channels/slack/socket-client');

    await new SlackSocketModeClient().handleSlashCommandEnvelope(envelope);

    expect(handleSlackSocketSlashCommand).toHaveBeenCalledWith(envelope);
  });

  it('handles Socket Mode interactive envelopes with the interaction handler', async () => {
    const ack = vi.fn().mockResolvedValue(undefined);
    const envelope = {
      ack,
      envelope_id: 'env-1',
      body: { type: 'message_action', callback_id: 'murph_personal_handoff', user: { id: 'U1' } }
    };
    const { SlackSocketModeClient } = await import('../src/lib/server/channels/slack/socket-client');

    await new SlackSocketModeClient().handleInteractiveEnvelope(envelope);

    expect(handleSlackSocketInteractive).toHaveBeenCalledWith(envelope);
  });
});
