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

  it('searches events within an explicit time window without requiring a query', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] })
    });
    vi.stubGlobal('fetch', fetch);

    const { getGoogleCalendarService } = await import('#lib/server/context-sources/google-calendar');
    const calendar = getGoogleCalendarService();
    await calendar.searchEvents('google-token', '', 25, {
      timeMin: '2026-05-11T00:00:00.000Z',
      timeMax: '2026-05-18T00:00:00.000Z'
    });

    const [url] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toContain('timeMin=2026-05-11T00%3A00%3A00.000Z');
    expect(String(url)).toContain('timeMax=2026-05-18T00%3A00%3A00.000Z');
    expect(String(url)).toContain('maxResults=25');
    expect(String(url)).not.toContain('&q=');
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
