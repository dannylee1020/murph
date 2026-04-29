import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutopilotSession, Workspace } from '../src/lib/types';

interface DiscordAdapterTestContext {
  store: Awaited<ReturnType<typeof loadStore>>;
  normalizeDiscordEvent: typeof import('../src/lib/server/channels/discord/adapter').normalizeDiscordEvent;
  workspace: Workspace;
  session: AutopilotSession;
}

async function loadStore() {
  const { getStore } = await import('#lib/server/persistence/store');
  return getStore();
}

async function setup(): Promise<DiscordAdapterTestContext> {
  const store = await loadStore();
  const { normalizeDiscordEvent } = await import('../src/lib/server/channels/discord/adapter');
  const workspace = store.saveInstall({
    provider: 'discord',
    externalWorkspaceId: 'G1',
    name: 'Discord Guild',
    botTokenEncrypted: 'test-token',
    botUserId: 'BOT1'
  });

  store.upsertUser({
    workspaceId: workspace.id,
    externalUserId: '10001',
    displayName: 'Owner'
  });

  const session = store.createSession({
    workspaceId: workspace.id,
    ownerUserId: '10001',
    title: 'Discord coverage',
    mode: 'manual_review',
    channelScope: ['C1'],
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });

  return { store, normalizeDiscordEvent, workspace, session };
}

function discordMessage(input: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'M1',
    guild_id: 'G1',
    channel_id: 'C1',
    author: { id: 'ASKER1' },
    content: '<@10001> can you check this?',
    ...input
  };
}

describe('normalizeDiscordEvent', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-discord-adapter-')), 'murph.sqlite');
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  });

  it('routes ordinary channel messages that mention an active session owner', async () => {
    const { normalizeDiscordEvent } = await setup();
    const task = normalizeDiscordEvent(discordMessage({}), { eventId: 'E1', teamId: 'G1' });

    expect(task?.targetUserId).toBe('10001');
    expect(task?.thread).toMatchObject({
      provider: 'discord',
      channelId: 'C1',
      threadTs: 'M1',
      rootMessageId: 'M1'
    });
  });

  it('normalizes thread channel messages with parent channel linkage', async () => {
    const { normalizeDiscordEvent } = await setup();
    const task = normalizeDiscordEvent(
      discordMessage({
        id: 'M2',
        channel_id: 'T100',
        parent_id: 'C1',
        type: 11,
        content: '<@10001> update?'
      }),
      { eventId: 'E2', teamId: 'G1' }
    );

    expect(task?.thread).toMatchObject({
      provider: 'discord',
      channelId: 'C1',
      threadTs: 'T100',
      threadChannelId: 'T100'
    });
  });
});
