import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('GoogleCalendarService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GOOGLE_CALENDAR_ID = 'primary';
  });

  it('checks availability for a specific window and returns compact busy blocks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'event-2',
            summary: 'Team sync',
            start: { dateTime: '2026-05-14T16:00:00Z' },
            end: { dateTime: '2026-05-14T16:30:00Z' }
          }
        ]
      })
    }));

    const { getGoogleCalendarService } = await import('#lib/server/context-sources/google-calendar');
    const calendar = getGoogleCalendarService();
    const result = await calendar.checkAvailability('google-token', {
      timezone: 'America/Los_Angeles',
      windowStart: '2026-05-14T16:00:00.000Z',
      windowEnd: '2026-05-15T00:00:00.000Z'
    });

    expect(result).toEqual({
      timezone: 'America/Los_Angeles',
      windowStart: '2026-05-14T16:00:00.000Z',
      windowEnd: '2026-05-15T00:00:00.000Z',
      hasConflicts: true,
      eventCount: 1,
      busyBlocks: [
        {
          start: '2026-05-14T16:00:00Z',
          end: '2026-05-14T16:30:00Z',
          title: 'Team sync'
        }
      ]
    });
  });
});
