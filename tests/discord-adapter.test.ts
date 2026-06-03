import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function setup() {
  const { getStore } = await import('../shared/server/persistence/store');
  const { normalizeDiscordEventWithReason } = await import('../shared/server/channels/discord/adapter');
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
  const session = store.createSession({
    workspaceId: workspace.id,
    title: 'Team stakeholder coverage',
    mode: 'manual_review',
    channelScope: ['C1'],
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  return { store, workspace, session, normalizeDiscordEventWithReason };
}

function discordEvent(input: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'M1',
    guild_id: 'G1',
    channel_id: 'C1',
    author: { id: '456' },
    content: '<@999> can you review this?',
    ...input
  };
}

describe('normalizeDiscordEventWithReason', () => {
  beforeEach(() => {
    vi.resetModules();
    const root = mkdtempSync(join(tmpdir(), 'murph-discord-adapter-'));
    process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
    process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
    delete process.env.MURPH_PRODUCT_MODE;
    delete process.env.MURPH_DISTRIBUTION;
    process.env.DISCORD_PERSONAL_CLIENT_ID = 'DISCORDPERSONAL';
  });

  it('routes structured Discord bot mentions to the active team session', async () => {
    const { normalizeDiscordEventWithReason } = await setup();

    const result = normalizeDiscordEventWithReason(discordEvent({
      content: '',
      mentions: [{ id: '999' }]
    }), { eventId: 'M1', teamId: 'G1' });

    expect(result.task?.targetUserId).toBeUndefined();
    expect(result.task?.sessionId).toBeDefined();
    expect(result.task?.thread).toMatchObject({ provider: 'discord', channelId: 'C1', threadTs: 'M1' });
    expect(result.task?.actorUserId).toBe('456');
    expect(result.task?.triggerMessage).toMatchObject({
      provider: 'discord',
      userId: '456',
      text: '',
      ts: 'M1'
    });
  });

  it('ignores channel messages that do not mention the team bot', async () => {
    const { normalizeDiscordEventWithReason } = await setup();

    const result = normalizeDiscordEventWithReason(discordEvent({
      content: '',
      mentions: [{ id: '123' }]
    }), { eventId: 'M5', teamId: 'G1' });

    expect(result).toMatchObject({ ignoredReason: 'bot_not_mentioned' });
  });

  it('routes teammate direct messages to the represented owner through a personal bot', async () => {
    const { store, workspace, normalizeDiscordEventWithReason } = await setup();
    store.stopSession(store.listActiveSessions(workspace.id)[0].id, 'stopped');
    const personalInstall = store.upsertBotInstallation({
      workspaceId: workspace.id,
      provider: 'discord',
      externalWorkspaceId: workspace.externalWorkspaceId,
      role: 'personal',
      appId: 'DISCORDPERSONAL',
      botUserId: '999',
      representedUserId: '123'
    });
    const { updateMurphSetupDefaults } = await import('../shared/server/setup/config-file');
    updateMurphSetupDefaults({
      channelProvider: 'discord',
      workspaceId: workspace.id,
      workspaceOwners: [
        {
          workspaceId: workspace.id,
          ownerUserId: '123',
          ownerDisplayName: 'Owner'
        }
      ]
    });

    const result = normalizeDiscordEventWithReason(discordEvent({
      guild_id: undefined,
      channel_id: 'DM1',
      author: { id: '456' },
      content: 'draft this'
    }), { eventId: 'Dm1', botRole: 'personal', botInstallationId: personalInstall.id });

    expect(result.task).toMatchObject({
      workspaceId: workspace.id,
      botRole: 'personal',
      botInstallationId: personalInstall.id,
      conversationKind: 'direct',
      targetUserId: '123',
      actorUserId: '456',
      thread: { provider: 'discord', channelId: 'DM1', threadTs: 'M1' }
    });
    expect(store.getDirectConversationByChannel('discord', 'DM1')).toMatchObject({
      workspaceId: workspace.id,
      externalUserId: '456',
      botInstallationId: personalInstall.id
    });
  });

  it('routes owner direct messages in the personal distribution', async () => {
    process.env.MURPH_DISTRIBUTION = 'personal';
    const { store, workspace, normalizeDiscordEventWithReason } = await setup();
    store.stopSession(store.listActiveSessions(workspace.id)[0].id, 'stopped');
    const personalInstall = store.upsertBotInstallation({
      workspaceId: workspace.id,
      provider: 'discord',
      externalWorkspaceId: workspace.externalWorkspaceId,
      role: 'personal',
      appId: 'DISCORDPERSONAL',
      botUserId: '999',
      representedUserId: '123'
    });

    const result = normalizeDiscordEventWithReason(discordEvent({
      guild_id: undefined,
      channel_id: 'DM1',
      author: { id: '123' },
      content: 'check my notes'
    }), { eventId: 'OwnerDm1', botRole: 'personal', botInstallationId: personalInstall.id });

    expect(result.task).toMatchObject({
      conversationKind: 'direct',
      targetUserId: '123',
      actorUserId: '123',
      thread: { provider: 'discord', channelId: 'DM1', threadTs: 'M1' }
    });
  });

  it('routes non-owner direct messages to the represented owner in the personal distribution', async () => {
    process.env.MURPH_DISTRIBUTION = 'personal';
    const { store, workspace, normalizeDiscordEventWithReason } = await setup();
    const personalInstall = store.upsertBotInstallation({
      workspaceId: workspace.id,
      provider: 'discord',
      externalWorkspaceId: workspace.externalWorkspaceId,
      role: 'personal',
      appId: 'DISCORDPERSONAL',
      botUserId: '999',
      representedUserId: '123'
    });

    const result = normalizeDiscordEventWithReason(discordEvent({
      guild_id: undefined,
      channel_id: 'DM1',
      author: { id: '456' },
      content: 'draft this'
    }), { eventId: 'NonOwnerDm1', botRole: 'personal', botInstallationId: personalInstall.id });

    expect(result.task).toMatchObject({
      workspaceId: workspace.id,
      botRole: 'personal',
      botInstallationId: personalInstall.id,
      conversationKind: 'direct',
      targetUserId: '123',
      actorUserId: '456',
      thread: { provider: 'discord', channelId: 'DM1', threadTs: 'M1' }
    });
  });

  it('uses the single scoped team session fallback for bot-directed messages', async () => {
    const { normalizeDiscordEventWithReason } = await setup();

    const result = normalizeDiscordEventWithReason(discordEvent({
      content: '<@999> help'
    }), { eventId: 'M2', teamId: 'G1' });

    expect(result.task?.targetUserId).toBeUndefined();
    expect(result.task?.sessionId).toBeDefined();
  });

  it('returns ignored reasons for messages that do not target a session', async () => {
    const { normalizeDiscordEventWithReason } = await setup();

    const result = normalizeDiscordEventWithReason(discordEvent({
      content: 'anyone around?'
    }), { eventId: 'M3', teamId: 'G1' });

    expect(result).toMatchObject({ ignoredReason: 'bot_not_mentioned' });
  });

  it('uses stored thread state for continuations without requiring repeated mentions', async () => {
    const { store, workspace, session, normalizeDiscordEventWithReason } = await setup();
    store.upsertThreadState({
      workspaceId: workspace.id,
      sessionId: session.id,
      channelId: 'C1',
      threadTs: 'THREAD1',
      lastMessageTs: 'M1',
      continuityCase: 'clarification',
      status: 'active'
    });

    const result = normalizeDiscordEventWithReason(discordEvent({
      id: 'M2',
      channel_id: 'THREAD1',
      parent_id: 'C1',
      content: 'any update?',
      mentions: []
    }), { eventId: 'M2', teamId: 'G1' });

    expect(result.task?.targetUserId).toBeUndefined();
    expect(result.task?.sessionId).toBe(session.id);
  });
});
