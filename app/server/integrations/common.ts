import { localDateTimeToUtc } from '#app/server/util/cron';
import type { ContextSource } from '#app/types';

export function compact(value: unknown, limit = 1200): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

export function compactCalendarEvents(events: Array<{ title: string; start?: string; end?: string }>) {
  return events.map((event) => ({
    title: event.title,
    start: event.start,
    end: event.end
  }));
}

function parseLocalDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error('date must use YYYY-MM-DD format');
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

export function workdayWindowForDate(input: {
  date: string;
  timezone: string;
  workdayStartHour: number;
  workdayEndHour: number;
}) {
  if (input.workdayEndHour <= input.workdayStartHour) {
    throw new Error('user workday is invalid');
  }

  const { year, month, day } = parseLocalDate(input.date);
  const windowStart = localDateTimeToUtc({
    year,
    month,
    day,
    hour: input.workdayStartHour,
    minute: 0
  }, input.timezone).toISOString();
  const windowEnd = localDateTimeToUtc({
    year,
    month,
    day,
    hour: input.workdayEndHour,
    minute: 0
  }, input.timezone).toISOString();

  return { windowStart, windowEnd };
}

export function queryFromThread(input: Parameters<ContextSource['retrieve']>[0]): string {
  return input.context.thread.latestMessage ||
    input.context.thread.recentMessages.map((message) => message.text).join(' ');
}
