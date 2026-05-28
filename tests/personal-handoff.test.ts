import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('personal bot handoff', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    const root = mkdtempSync(join(tmpdir(), 'murph-personal-handoff-'));
    process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
    process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
    process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  });

  it('opens the selected Slack owner personal bot DM for the sender', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
      calls.push({ url: String(url), body: JSON.parse(String(options.body)) });
      if (String(url).includes('/conversations.open')) {
        return Response.json({ ok: true, channel: { id: 'D-personal' } });
      }
      return Response.json({ ok: true, ts: '123.456' });
    });
    const { getStore } = await import('../src/lib/server/persistence/store');
    const { writeSecret } = await import('../src/lib/server/credentials/local-store');
    const { openSlackPersonalHandoff } = await import('../src/lib/server/channels/personal-handoff');
    const store = getStore();
    const workspace = store.saveInstall({
      provider: 'slack',
      externalWorkspaceId: 'T1',
      name: 'Team',
      botUserId: 'UCHANNEL'
    });
    store.upsertUser({ workspaceId: workspace.id, externalUserId: 'UOWNER', displayName: 'Daniel' });
    const installation = store.upsertBotInstallation({
      provider: 'slack',
      workspaceId: workspace.id,
      externalWorkspaceId: workspace.externalWorkspaceId,
      role: 'personal',
      botUserId: 'UPERSONAL',
      representedUserId: 'UOWNER'
    });
    writeSecret('slack', 'bot_token', 'xoxb-personal', { botInstallationId: installation.id });

    const result = await openSlackPersonalHandoff({
      teamId: 'T1',
      senderUserId: 'UASKER',
      ownerUserId: 'UOWNER',
      selectedText: 'can you review this?'
    });

    expect(result).toMatchObject({ ok: true, ownerDisplayName: 'Daniel', channelId: 'D-personal' });
    expect(calls).toEqual([
      expect.objectContaining({ url: 'https://slack.com/api/conversations.open', body: { users: 'UASKER' } }),
      expect.objectContaining({
        url: 'https://slack.com/api/chat.postMessage',
        body: expect.objectContaining({
          channel: 'D-personal',
          text: expect.stringContaining('Murph Personal for Daniel')
        })
      })
    ]);
    expect(store.getDirectConversationByChannel('slack', 'D-personal')).toMatchObject({
      externalUserId: 'UASKER',
      botInstallationId: installation.id
    });
  });

  it('opens the selected Discord owner personal bot DM for the sender', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
      calls.push({ url: String(url), body: JSON.parse(String(options.body)) });
      if (String(url).includes('/users/@me/channels')) {
        return Response.json({ id: 'DM-discord' });
      }
      return Response.json({ id: 'message-1' });
    });
    const { getStore } = await import('../src/lib/server/persistence/store');
    const { writeSecret } = await import('../src/lib/server/credentials/local-store');
    const { openDiscordPersonalHandoff } = await import('../src/lib/server/channels/personal-handoff');
    const store = getStore();
    const workspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'personal:owner',
      name: 'Owner',
      botUserId: '999'
    });
    store.upsertUser({ workspaceId: workspace.id, externalUserId: 'owner', displayName: 'Daniel' });
    const installation = store.upsertBotInstallation({
      provider: 'discord',
      workspaceId: workspace.id,
      externalWorkspaceId: workspace.externalWorkspaceId,
      role: 'personal',
      botUserId: '999',
      representedUserId: 'owner'
    });
    writeSecret('discord', 'bot_token', 'discord-personal-token', { botInstallationId: installation.id });

    const result = await openDiscordPersonalHandoff({
      senderUserId: 'asker',
      ownerUserId: 'owner'
    });

    expect(result).toMatchObject({ ok: true, ownerDisplayName: 'Daniel', channelId: 'DM-discord' });
    expect(calls).toEqual([
      expect.objectContaining({ url: 'https://discord.com/api/v10/users/@me/channels', body: { recipient_id: 'asker' } }),
      expect.objectContaining({
        url: 'https://discord.com/api/v10/channels/DM-discord/messages',
        body: expect.objectContaining({ content: expect.stringContaining('Murph Personal for Daniel') })
      })
    ]);
    expect(store.getDirectConversationByChannel('discord', 'DM-discord')).toMatchObject({
      externalUserId: 'asker',
      botInstallationId: installation.id
    });
  });
});
