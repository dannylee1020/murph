interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function partsInTimeZone(date: Date, timezone: string): LocalDateTime {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function localTimestamp(input: LocalDateTime): number {
  return Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute);
}

function localDateTimeToUtc(input: LocalDateTime, timezone: string): Date {
  let guess = new Date(localTimestamp(input));

  for (let index = 0; index < 3; index += 1) {
    const actual = partsInTimeZone(guess, timezone);
    const offset = localTimestamp(input) - localTimestamp(actual);
    const next = new Date(guess.getTime() + offset);
    if (next.getTime() === guess.getTime()) {
      break;
    }
    guess = next;
  }

  return guess;
}

function addLocalDays(input: LocalDateTime, days: number): LocalDateTime {
  const date = new Date(Date.UTC(input.year, input.month - 1, input.day + days, input.hour, input.minute));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: input.hour,
    minute: input.minute
  };
}

export function parseLocalTime(value: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new Error('localTime must use HH:mm 24-hour format');
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2])
  };
}

export function nextDailyRun(localTime: string, timezone: string, after = new Date()): Date {
  const { hour, minute } = parseLocalTime(localTime);
  const afterLocal = partsInTimeZone(after, timezone);
  let candidateLocal: LocalDateTime = {
    year: afterLocal.year,
    month: afterLocal.month,
    day: afterLocal.day,
    hour,
    minute
  };
  let candidate = localDateTimeToUtc(candidateLocal, timezone);

  if (candidate <= after) {
    candidateLocal = addLocalDays(candidateLocal, 1);
    candidate = localDateTimeToUtc(candidateLocal, timezone);
  }

  return candidate;
}
