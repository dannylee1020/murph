import { getDiscordService, type DiscordSearchResult } from '#lib/server/channels/discord/service';
import type { ContextArtifact, ChannelThreadRef } from '#lib/types';

export function toArtifact(result: DiscordSearchResult): ContextArtifact {
  return {
    id: result.id,
    source: 'discord',
    type: 'other',
    title: result.threadChannelId ? 'Discord thread' : `Discord message ${result.channelId}`,
    text: result.text,
    url: result.permalink,
    metadata: {
      channelId: result.channelId,
      threadTs: result.threadTs,
      threadChannelId: result.threadChannelId,
      rootMessageId: result.rootMessageId,
      userId: result.userId
    }
  };
}

export function getDiscordArchiveService() {
  return getDiscordService();
}

export function readDiscordThread(input: {
  provider?: string;
  channelId: string;
  threadTs: string;
  threadChannelId?: string;
  rootMessageId?: string;
}) {
  const thread: ChannelThreadRef = {
    provider: 'discord',
    channelId: input.channelId,
    threadTs: input.threadTs,
    threadChannelId: input.threadChannelId,
    rootMessageId: input.rootMessageId
  };
  return thread;
}
