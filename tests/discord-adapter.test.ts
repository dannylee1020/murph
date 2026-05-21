import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function setup() {
  const { getStore } = await import('../src/lib/server/persistence/store');
  const { normalizeDiscordEventWithReason } = await import('../src/lib/server/channels/discord/adapter');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'discord',
    externalWorkspaceId: 'G1',
    name: 'Test Guild',
    botUserId: '999'
  });
  store.upsertUser({
    workspaceId: workspace.id,
    externalUserId: '123',
    displayName: 'Owner'
  });
  store.createSession({
    workspaceId: workspace.id,
    ownerUserId: '123',
    title: 'Overnight coverage',
    mode: 'manual_review',
    channelScope: ['C1'],
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  return { store, workspace, normalizeDiscordEventWithReason };
}

function discordEvent(input: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'M1',
    guild_id: 'G1',
    channel_id: 'C1',
    author: { id: '456' },
    content: '<@123> can you review this?',
    ...input
  };
}

describe('normalizeDiscordEventWithReason', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-discord-adapter-')), 'murph.sqlite');
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  });

  it('routes structured Discord mentions even when message content is empty', async () => {
    const { normalizeDiscordEventWithReason } = await setup();

    const result = normalizeDiscordEventWithReason(discordEvent({
      content: '',
      mentions: [{ id: '123' }]
    }), { eventId: 'M1', teamId: 'G1' });

    expect(result.task?.targetUserId).toBe('123');
    expect(result.task?.thread).toMatchObject({ provider: 'discord', channelId: 'C1', threadTs: 'M1' });
    expect(result.task?.actorUserId).toBe('456');
    expect(result.task?.triggerMessage).toMatchObject({
      provider: 'discord',
      userId: '456',
      text: '',
      ts: 'M1'
    });
  });

  it('uses the single scoped session fallback for bot-directed messages', async () => {
    const { normalizeDiscordEventWithReason } = await setup();

    const result = normalizeDiscordEventWithReason(discordEvent({
      content: '<@999> help'
    }), { eventId: 'M2', teamId: 'G1' });

    expect(result.task?.targetUserId).toBe('123');
  });

  it('returns ignored reasons for messages that do not target a session', async () => {
    const { normalizeDiscordEventWithReason } = await setup();

    const result = normalizeDiscordEventWithReason(discordEvent({
      content: 'anyone around?'
    }), { eventId: 'M3', teamId: 'G1' });

    expect(result).toMatchObject({ ignoredReason: 'no_mentioned_session_owner' });
  });
});
