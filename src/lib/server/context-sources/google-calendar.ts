import { getRuntimeEnv } from '#lib/server/util/env';
import type { ContextArtifact } from '#lib/types';

interface CalendarEventsResponse {
  items?: CalendarEvent[];
}

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
  attendees?: Array<{ email?: string }>;
}

export interface CalendarEventResult {
  id: string;
  title: string;
  description: string;
  url?: string;
  start?: string;
  end?: string;
  attendees: string[];
}

export interface CalendarAvailabilityResult {
  timezone: string;
  windowStart: string;
  windowEnd: string;
  hasConflicts: boolean;
  eventCount: number;
  busyBlocks: Array<{ start?: string; end?: string; title: string }>;
}

function compact(value: string | undefined, limit = 4000): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function toArtifact(event: CalendarEventResult): ContextArtifact {
  return {
    id: `calendar:${event.id}`,
    source: 'calendar',
    type: 'event',
    title: event.title,
    text: event.description || event.title,
    url: event.url,
    metadata: {
      start: event.start,
      end: event.end,
      attendees: event.attendees
    }
  };
}

export class GoogleCalendarService {
  async upcomingEvents(accessToken: string, limit = 5): Promise<{ events: CalendarEventResult[] }> {
    return await this.listEvents(accessToken, {
      maxResults: limit,
      timeMin: new Date().toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
  }

  async searchEvents(
    accessToken: string,
    query: string,
    limit = 5,
    options?: { timeMin?: string; timeMax?: string }
  ): Promise<{ events: CalendarEventResult[] }> {
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const to = new Date();
    to.setDate(to.getDate() + 60);

    const params: Record<string, string | number | boolean> = {
      maxResults: limit,
      timeMin: options?.timeMin ?? from.toISOString(),
      timeMax: options?.timeMax ?? to.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    };
    if (query) {
      params.q = query;
    }

    return await this.listEvents(accessToken, params);
  }

  async checkAvailability(
    accessToken: string,
    input: { timezone: string; windowStart: string; windowEnd: string }
  ): Promise<CalendarAvailabilityResult> {
    const result = await this.listEvents(accessToken, {
      maxResults: 250,
      timeMin: input.windowStart,
      timeMax: input.windowEnd,
      singleEvents: true,
      orderBy: 'startTime'
    });

    const busyBlocks = result.events.map((event) => ({
      start: event.start,
      end: event.end,
      title: event.title
    }));

    return {
      timezone: input.timezone,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      hasConflicts: busyBlocks.length > 0,
      eventCount: busyBlocks.length,
      busyBlocks
    };
  }

  private async listEvents(accessToken: string, params: Record<string, string | number | boolean>): Promise<{ events: CalendarEventResult[] }> {
    const calendarId = getRuntimeEnv().googleCalendarId;
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const payload = await this.fetchJson<CalendarEventsResponse>(accessToken, url.toString());
    return {
      events: (payload.items ?? []).map((event) => ({
        id: event.id,
        title: compact(event.summary, 200) || 'Untitled event',
        description: compact(event.description),
        url: event.htmlLink,
        start: event.start?.dateTime ?? event.start?.date,
        end: event.end?.dateTime ?? event.end?.date,
        attendees: (event.attendees ?? []).map((attendee) => attendee.email ?? '').filter(Boolean)
      }))
    };
  }

  private async fetchJson<T>(accessToken: string, url: string): Promise<T> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `Google Calendar request failed with ${response.status}`);
    }

    return payload;
  }
}

let singleton: GoogleCalendarService | null = null;

export function getGoogleCalendarService(): GoogleCalendarService {
  if (!singleton) {
    singleton = new GoogleCalendarService();
  }

  return singleton;
}
