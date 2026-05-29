import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('calendar tools', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GOOGLE_CALENDAR_ID = 'primary';
    process.env.GOOGLE_ACCESS_TOKEN = 'google-token';
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  });

  it('checks workday availability for calendar.check_availability', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'event-2',
            summary: 'Lunch',
            start: { dateTime: '2026-05-14T19:00:00Z' },
            end: { dateTime: '2026-05-14T20:00:00Z' }
          }
        ]
      })
    }));

    const { getToolRegistry } = await import('#shared/server/capabilities/tool-registry');
    const { registerBuiltInTools } = await import('#shared/server/capabilities/builtins');
    const { registerBuiltInIntegrationAdapters } = await import('#shared/server/integrations/register-builtins');
    const { getStore } = await import('#shared/server/persistence/store');
    registerBuiltInTools();
    registerBuiltInIntegrationAdapters();
    const store = getStore();
    store.upsertUser({
      workspaceId: 'workspace',
      externalUserId: 'owner',
      displayName: 'Owner',
      timezone: 'America/Los_Angeles',
      workdayStartHour: 9,
      workdayEndHour: 17
    });

    const registry = getToolRegistry();
    const output = await registry.execute('calendar.check_availability', {
      date: '2026-05-14',
      window: 'workday'
    }, {
      workspace: { id: 'workspace', provider: 'slack', externalWorkspaceId: 'T1', name: 'Workspace' },
      workspaceMemory: {
        workspaceId: 'workspace',
        channelMappings: [],
        escalationRules: [],
        enabledOptionalTools: ['calendar.check_availability'],
        enabledContextSources: [],
        enabledPlugins: []
      },
      task: {
        id: 'task',
        source: 'slack_event',
        workspaceId: 'workspace',
        thread: { provider: 'slack', channelId: 'C1', threadTs: '1.0' },
        targetUserId: 'owner',
        receivedAt: new Date().toISOString()
      }
    } as any);

    expect(output).toEqual({
      timezone: 'America/Los_Angeles',
      windowStart: '2026-05-14T16:00:00.000Z',
      windowEnd: '2026-05-15T00:00:00.000Z',
      hasConflicts: true,
      eventCount: 1,
      busyBlocks: [
        {
          start: '2026-05-14T19:00:00Z',
          end: '2026-05-14T20:00:00Z',
          title: 'Lunch'
        }
      ]
    });
  });

  it('fails workday availability when target user schedule is missing', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const { getToolRegistry } = await import('#shared/server/capabilities/tool-registry');
    const { registerBuiltInTools } = await import('#shared/server/capabilities/builtins');
    const { registerBuiltInIntegrationAdapters } = await import('#shared/server/integrations/register-builtins');
    registerBuiltInTools();
    registerBuiltInIntegrationAdapters();
    const registry = getToolRegistry();

    await expect(registry.execute('calendar.check_availability', {
      date: '2026-05-14',
      window: 'workday'
    }, {
      workspace: { id: 'workspace', provider: 'slack', externalWorkspaceId: 'T1', name: 'Workspace' },
      workspaceMemory: {
        workspaceId: 'workspace',
        channelMappings: [],
        escalationRules: [],
        enabledOptionalTools: ['calendar.check_availability'],
        enabledContextSources: [],
        enabledPlugins: []
      },
      task: {
        id: 'task',
        source: 'slack_event',
        workspaceId: 'workspace',
        thread: { provider: 'slack', channelId: 'C1', threadTs: '1.0' },
        targetUserId: 'missing',
        receivedAt: new Date().toISOString()
      }
    } as any)).rejects.toThrow('Target user schedule is unavailable');
  });
});
