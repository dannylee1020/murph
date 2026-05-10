import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('getGatewaySnapshot', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns active sessions even when the latest installed workspace is different', async () => {
    process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-snapshot-')), 'murph.sqlite');
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';

    vi.doMock('#lib/server/runtime/bootstrap', () => ({
      ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
    }));

    const { getStore } = await import('#lib/server/persistence/store');
    const store = getStore();
    const activeWorkspace = store.saveInstall({
      provider: 'slack',
      externalWorkspaceId: 'T_ACTIVE',
      name: 'Active Workspace',
      botTokenEncrypted: 'token',
      botUserId: 'UBOT'
    });
    const activeSession = store.createSession({
      workspaceId: activeWorkspace.id,
      ownerUserId: 'UOWNER',
      title: 'Watching overnight',
      mode: 'manual_review',
      channelScope: [],
      endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    store.saveInstall({
      provider: 'slack',
      externalWorkspaceId: 'T_LATEST',
      name: 'Latest Workspace',
      botTokenEncrypted: 'token',
      botUserId: 'UBOT'
    });

    const { getGatewaySnapshot } = await import('#lib/server/runtime/snapshot');
    const snapshot = await getGatewaySnapshot();

    expect(snapshot.summary.activeSessionCount).toBe(1);
    expect(snapshot.sessions.map((session) => session.id)).toContain(activeSession.id);
  });
});
