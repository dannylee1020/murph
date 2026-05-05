import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('GoogleCalendarService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GOOGLE_CALENDAR_ID = 'primary';
  });

  it('loads upcoming events and maps them to artifacts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'event-1',
            summary: 'Investor sync',
            description: 'Discuss fundraising progress',
            htmlLink: 'https://calendar.google.com/event?eid=1',
            start: { dateTime: '2026-04-29T16:00:00Z' },
            end: { dateTime: '2026-04-29T16:30:00Z' },
            attendees: [{ email: 'investor@example.com' }]
          }
        ]
      })
    }));

    const { getGoogleCalendarService, toArtifact } = await import('#lib/server/context-sources/google-calendar');
    const calendar = getGoogleCalendarService();
    const result = await calendar.upcomingEvents('google-token', 3);

    expect(result.events[0]).toEqual(expect.objectContaining({
      id: 'event-1',
      title: 'Investor sync'
    }));
    expect(toArtifact(result.events[0])).toEqual(expect.objectContaining({ source: 'calendar', type: 'event' }));
  });
});
