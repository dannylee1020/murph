import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envKeys = ['MURPH_SQLITE_PATH'] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

describe('app settings store', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MURPH_SQLITE_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'murph-app-settings-')), 'murph.sqlite');
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('preserves selected bot roles in setup defaults', async () => {
    const { getStore } = await import('../shared/server/persistence/store');
    const store = getStore();

    store.upsertAppSettings({
      setupDefaults: {
        botRoles: ['personal'],
        providerBotRoles: {
          discord: ['personal']
        },
        channelProvider: 'discord'
      }
    });

    expect(store.getAppSettings().setupDefaults).toMatchObject({
      botRoles: ['personal'],
      providerBotRoles: {
        discord: ['personal']
      },
      channelProvider: 'discord'
    });
  });
});
