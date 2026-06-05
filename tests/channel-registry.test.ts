import { describe, expect, it, vi } from 'vitest';
import { ChannelRegistry } from '../app/server/capabilities/channel-registry';
import type { ChannelAdapter, Workspace } from '../app/types';

function adapter(id: string, postReply = vi.fn()): ChannelAdapter {
  return {
    id,
    displayName: id,
    capabilities: ['event_ingress', 'thread_fetch', 'reply_post'],
    normalizeEvent() {
      return null;
    },
    async fetchThread() {
      return [];
    },
    postReply
  };
}

describe('ChannelRegistry', () => {
  it('uses the workspace provider when a thread ref has no provider', async () => {
    const registry = new ChannelRegistry();
    const slackPostReply = vi.fn();
    const discordPostReply = vi.fn();
    registry.register(adapter('slack', slackPostReply));
    registry.register(adapter('discord', discordPostReply));
    const workspace: Workspace = {
      id: 'ws-discord',
      provider: 'discord',
      externalWorkspaceId: 'guild-1',
      name: 'Discord Guild'
    };

    await registry.postReply(workspace, { channelId: 'D1', threadTs: 'M1' }, 'hello');

    expect(discordPostReply).toHaveBeenCalledOnce();
    expect(slackPostReply).not.toHaveBeenCalled();
  });
});
