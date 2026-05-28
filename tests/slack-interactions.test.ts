import { beforeEach, describe, expect, it, vi } from 'vitest';

const openSlackPersonalHandoff = vi.fn();

vi.mock('#lib/server/channels/personal-handoff', () => ({
  openSlackPersonalHandoff
}));

describe('Slack interactions', () => {
  beforeEach(() => {
    vi.resetModules();
    openSlackPersonalHandoff.mockReset();
    openSlackPersonalHandoff.mockResolvedValue({
      ok: true,
      message: 'Opened Murph Personal for Danny. Continue in that DM.'
    });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  it('parses Slack slash command form payloads', async () => {
    const { handleSlackInteractionPayload, parseSlackInteractionPayload } = await import('../src/lib/server/channels/slack/interactions');

    const payload = parseSlackInteractionPayload(new URLSearchParams({
      command: '/murph',
      team_id: 'T1',
      user_id: 'U2',
      text: '<@U1> can you help?',
      response_url: 'https://hooks.slack.test/response'
    }).toString());
    const result = await handleSlackInteractionPayload(payload);

    expect(result).toEqual({
      ok: true,
      response_type: 'ephemeral',
      text: 'Opened Murph Personal for Danny. Continue in that DM.'
    });
    expect(openSlackPersonalHandoff).toHaveBeenCalledWith({
      teamId: 'T1',
      senderUserId: 'U2',
      ownerUserId: 'U1',
      ownerHint: 'can you help?',
      selectedText: undefined
    });
  });

  it('uses the selected message author and text from Slack message shortcuts', async () => {
    const { handleSlackInteractionPayload } = await import('../src/lib/server/channels/slack/interactions');

    await handleSlackInteractionPayload({
      type: 'message_action',
      callback_id: 'murph_personal_handoff',
      team: { id: 'T1' },
      user: { id: 'U2' },
      message: { user: 'U1', text: 'Original DM text' }
    });

    expect(openSlackPersonalHandoff).toHaveBeenCalledWith({
      teamId: 'T1',
      senderUserId: 'U2',
      ownerUserId: 'U1',
      ownerHint: undefined,
      selectedText: 'Original DM text'
    });
  });

  it('acks Socket Mode slash commands and posts final feedback to Slack response_url', async () => {
    const ack = vi.fn().mockResolvedValue(undefined);
    const { handleSlackSocketSlashCommand } = await import('../src/lib/server/channels/slack/interactions');

    await handleSlackSocketSlashCommand({
      ack,
      body: {
        command: '/murph',
        team_id: 'T1',
        user_id: 'U2',
        text: '<@U1>',
        response_url: 'https://hooks.slack.test/response'
      }
    });

    expect(ack).toHaveBeenCalledWith({
      response_type: 'ephemeral',
      text: 'Opening Murph Personal...'
    });
    expect(globalThis.fetch).toHaveBeenCalledWith('https://hooks.slack.test/response', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: 'Opened Murph Personal for Danny. Continue in that DM.'
      })
    }));
  });

  it('acks unrelated Socket Mode interactive payloads without opening a DM', async () => {
    const ack = vi.fn().mockResolvedValue(undefined);
    const { handleSlackSocketInteractive } = await import('../src/lib/server/channels/slack/interactions');

    await handleSlackSocketInteractive({
      ack,
      body: {
        type: 'message_action',
        callback_id: 'other_action',
        user: { id: 'U2' }
      }
    });

    expect(ack).toHaveBeenCalledOnce();
    expect(openSlackPersonalHandoff).not.toHaveBeenCalled();
  });
});

