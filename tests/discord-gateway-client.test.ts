import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Discord gateway bot installation selection', () => {
  beforeEach(() => {
    vi.resetModules();
    const root = mkdtempSync(join(tmpdir(), 'murph-discord-gateway-'));
    process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
    process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  });

  it('uses the current personal installation for direct messages from any author', async () => {
    const { getStore } = await import('../app/server/persistence/store');
    const { discordBotInstallationForEvent } = await import('../app/server/channels/discord/gateway-client');
    const store = getStore();
    store.upsertBotAppConfig({ provider: 'discord', role: 'personal', appId: 'current-app', clientId: 'current-app' });
    const oldWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'personal:old-owner',
      name: 'Old Owner',
      role: 'personal',
      appId: 'old-app',
      representedUserId: 'old-owner'
    });
    store.upsertBotInstallation({
      workspaceId: oldWorkspace.id,
      provider: 'discord',
      role: 'personal',
      externalWorkspaceId: oldWorkspace.externalWorkspaceId,
      appId: 'old-app',
      representedUserId: 'old-owner'
    });
    const currentWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Guild',
      role: 'personal',
      appId: 'current-app',
      representedUserId: 'current-owner'
    });
    const currentInstallation = store.upsertBotInstallation({
      workspaceId: currentWorkspace.id,
      provider: 'discord',
      role: 'personal',
      externalWorkspaceId: currentWorkspace.externalWorkspaceId,
      appId: 'current-app',
      representedUserId: 'current-owner'
    });

    const selected = discordBotInstallationForEvent('personal', {
      author: { id: 'other-user' },
      channel_id: 'DM1'
    });

    expect(selected?.id).toBe(currentInstallation.id);
  });

  it('does not fall back to a stale personal installation', async () => {
    const { getStore } = await import('../app/server/persistence/store');
    const { discordBotInstallationForEvent } = await import('../app/server/channels/discord/gateway-client');
    const store = getStore();
    store.upsertBotAppConfig({ provider: 'discord', role: 'personal', appId: 'current-app', clientId: 'current-app' });
    const workspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'personal:old-owner',
      name: 'Old Owner',
      role: 'personal',
      appId: 'old-app',
      representedUserId: 'old-owner'
    });
    store.upsertBotInstallation({
      workspaceId: workspace.id,
      provider: 'discord',
      role: 'personal',
      externalWorkspaceId: workspace.externalWorkspaceId,
      appId: 'old-app',
      representedUserId: 'old-owner'
    });

    const selected = discordBotInstallationForEvent('personal', {
      author: { id: 'other-user' },
      channel_id: 'DM1'
    });

    expect(selected).toBeUndefined();
  });

  it('does not guess between multiple current personal installations for direct messages', async () => {
    const { getStore } = await import('../app/server/persistence/store');
    const { discordBotInstallationForEvent } = await import('../app/server/channels/discord/gateway-client');
    const store = getStore();
    store.upsertBotAppConfig({ provider: 'discord', role: 'personal', appId: 'current-app', clientId: 'current-app' });
    for (const [externalWorkspaceId, owner] of [['G1', 'owner-1'], ['G2', 'owner-2']] as const) {
      const workspace = store.saveInstall({
        provider: 'discord',
        externalWorkspaceId,
        name: externalWorkspaceId,
        role: 'personal',
        appId: 'current-app',
        representedUserId: owner
      });
      store.upsertBotInstallation({
        workspaceId: workspace.id,
        provider: 'discord',
        role: 'personal',
        externalWorkspaceId,
        appId: 'current-app',
        representedUserId: owner
      });
    }

    const selected = discordBotInstallationForEvent('personal', {
      author: { id: 'other-user' },
      channel_id: 'DM1'
    });

    expect(selected).toBeUndefined();
  });

  it('uses the guild installation for guild messages', async () => {
    const { getStore } = await import('../app/server/persistence/store');
    const { discordBotInstallationForEvent } = await import('../app/server/channels/discord/gateway-client');
    const store = getStore();
    store.upsertBotAppConfig({ provider: 'discord', role: 'channel', appId: 'guild-app', clientId: 'guild-app' });
    const workspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Guild',
      role: 'channel',
      appId: 'guild-app'
    });
    const installation = store.upsertBotInstallation({
      workspaceId: workspace.id,
      provider: 'discord',
      role: 'channel',
      externalWorkspaceId: 'G1',
      appId: 'guild-app'
    });

    const selected = discordBotInstallationForEvent('channel', {
      guild_id: 'G1',
      author: { id: 'user' }
    }, 'G1');

    expect(selected?.id).toBe(installation.id);
  });
});
