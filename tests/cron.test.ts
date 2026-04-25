import { describe, expect, it } from 'vitest';
import { nextDailyRun, parseLocalTime } from '../src/lib/server/util/cron';

describe('daily recurring scheduler', () => {
  it('parses strict 24-hour local times', () => {
    expect(parseLocalTime('08:30')).toEqual({ hour: 8, minute: 30 });
    expect(() => parseLocalTime('8:30')).toThrow();
    expect(() => parseLocalTime('24:00')).toThrow();
  });

  it('returns today when the local target time is still ahead', () => {
    const next = nextDailyRun('08:30', 'America/Los_Angeles', new Date('2026-04-20T14:00:00.000Z'));
    expect(next.toISOString()).toBe('2026-04-20T15:30:00.000Z');
  });

  it('returns tomorrow when the local target time already passed', () => {
    const next = nextDailyRun('08:30', 'America/Los_Angeles', new Date('2026-04-20T17:00:00.000Z'));
    expect(next.toISOString()).toBe('2026-04-21T15:30:00.000Z');
  });

  it('honors DST offset changes', () => {
    const spring = nextDailyRun('08:30', 'America/Los_Angeles', new Date('2026-03-07T18:00:00.000Z'));
    const afterSpring = nextDailyRun('08:30', 'America/Los_Angeles', spring);

    expect(spring.toISOString()).toBe('2026-03-08T15:30:00.000Z');
    expect(afterSpring.toISOString()).toBe('2026-03-09T15:30:00.000Z');
  });
});
