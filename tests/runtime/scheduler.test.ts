import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const slackMock = vi.hoisted(() => ({
  setPresence: vi.fn()
}));

vi.mock('#app/server/channels/slack/service', () => ({
  getSlackService: () => slackMock
}));

async function setup(options: { setupSchedule?: boolean; configSchedule?: boolean } = {}) {
  const setupSchedule = options.setupSchedule ?? true;
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-oss-scheduler-'));
  process.env.MURPH_HOME = root;
  process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  if (options.configSchedule) {
    writeFileSync(process.env.MURPH_CONFIG_PATH, [
      'app:',
      '  timezone: America/Los_Angeles',
      '  workdayStartHour: 9',
      '  workdayEndHour: 17'
    ].join('\n'));
  }
  const { getStore } = await import('#app/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  store.upsertAppSettings({
    ...store.getAppSettings(),
    setupDefaults: {
      channelProvider: 'slack',
      workspaceId: workspace.id,
      channelScopeMode: 'selected',
      selectedChannels: [{ id: 'C1', displayName: '#support' }],
      ...(setupSchedule
        ? {
            timezone: 'America/Los_Angeles',
            workdayStartHour: 9,
            workdayEndHour: 17
          }
        : {})
    }
  });
  const scheduler = await import('../../app/server/runtime/scheduler');
  return { store, workspace, ...scheduler };
}

describe('OSS working-hours scheduler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    slackMock.setPresence.mockReset();
    slackMock.setPresence.mockResolvedValue(undefined);
    delete process.env.MURPH_HOME;
    delete process.env.MURPH_CONFIG_PATH;
    delete process.env.MURPH_SQLITE_PATH;
    delete process.env.MURPH_CREDENTIALS_PATH;
    delete process.env.MURPH_ENCRYPTION_KEY;
  });

  it('starts scheduled coverage outside weekday work hours', async () => {
    const { store, workspace, runScheduleHeartbeat } = await setup();

    const result = await runScheduleHeartbeat(new Date('2026-06-17T02:00:00.000Z'));

    expect(result).toMatchObject({ inspected: 1, started: 1, stopped: 0, skipped: 0 });
    const session = store.listActiveSessions(workspace.id)[0];
    expect(session).toMatchObject({
      title: 'Scheduled coverage',
      source: 'schedule',
      channelScope: ['C1']
    });
    expect(slackMock.setPresence).toHaveBeenCalledWith(expect.objectContaining({ id: workspace.id }), 'auto');
  });

  it('uses config-file schedule when setup defaults only define targets', async () => {
    const { store, workspace, runScheduleHeartbeat } = await setup({
      setupSchedule: false,
      configSchedule: true
    });

    const result = await runScheduleHeartbeat(new Date('2026-06-17T02:00:00.000Z'));

    expect(result).toMatchObject({ inspected: 1, started: 1, stopped: 0, skipped: 0 });
    expect(store.listActiveSessions(workspace.id)[0]).toMatchObject({
      source: 'schedule',
      channelScope: ['C1']
    });
  });

  it('stops only scheduled coverage during weekday work hours', async () => {
    const { store, workspace, runScheduleHeartbeat } = await setup();
    store.createSession({
      workspaceId: workspace.id,
      title: 'Scheduled coverage',
      mode: 'manual_review',
      source: 'schedule',
      channelScope: ['C1'],
      endsAt: '2030-06-09T02:00:00.000Z'
    });
    store.createSession({
      workspaceId: workspace.id,
      title: 'Manual coverage',
      mode: 'manual_review',
      source: 'manual',
      channelScope: ['C1'],
      endsAt: '2030-06-09T02:00:00.000Z'
    });

    const result = await runScheduleHeartbeat(new Date('2026-06-16T16:00:00.000Z'));

    expect(result).toMatchObject({ inspected: 1, started: 0, stopped: 1, skipped: 0 });
    const active = store.listActiveSessions(workspace.id);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ title: 'Manual coverage', source: 'manual' });
    expect(slackMock.setPresence).toHaveBeenCalledWith(expect.objectContaining({ id: workspace.id }), 'auto');
  });

  it('manual coverage prevents scheduled auto-start outside work hours', async () => {
    const { store, workspace, runScheduleHeartbeat } = await setup();
    store.createSession({
      workspaceId: workspace.id,
      title: 'Manual coverage',
      mode: 'manual_review',
      source: 'manual',
      channelScope: ['C1'],
      endsAt: '2030-06-09T02:00:00.000Z'
    });

    const result = await runScheduleHeartbeat(new Date('2026-06-17T01:00:00.000Z'));

    expect(result).toMatchObject({ inspected: 1, started: 0, stopped: 0, skipped: 1 });
    expect(store.listActiveSessions(workspace.id)).toHaveLength(1);
    expect(slackMock.setPresence).toHaveBeenCalledWith(expect.objectContaining({ id: workspace.id }), 'auto');
  });
});
