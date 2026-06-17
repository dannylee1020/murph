import { emitControlPlaneEvent } from '#app/server/runtime/control-plane';
import { getStore } from '#app/server/persistence/store';
import { scheduleWithConfigFallback } from '#app/server/setup/config-schedule';
import { localDateTimeToUtc, type LocalDateTime } from '#app/server/util/cron';
import { resolveSessionPolicy } from './session-policy.js';
import { syncSlackPresenceForWorkspace } from './slack-presence.js';
import type { AppSettings, AutopilotSession, SetupDefaults, UserSchedule, Workspace } from '#app/types';

export interface SchedulerTickResult {
  inspected: number;
  started: number;
  stopped: number;
  skipped: number;
}

function localParts(date: Date, timezone: string): LocalDateTime & { weekday: number; hour: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdays[String(parts.weekday)] ?? 7,
    hour: Number(parts.hour),
    minute: 0
  };
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

export function isWithinWeekdayWorkHours(schedule: UserSchedule, now = new Date()): boolean {
  if (!schedule.timezone.trim()) return false;
  if (!Number.isInteger(schedule.workdayStartHour) || !Number.isInteger(schedule.workdayEndHour)) return false;
  if (schedule.workdayStartHour < 0 || schedule.workdayEndHour > 24 || schedule.workdayEndHour <= schedule.workdayStartHour) return false;
  const parts = localParts(now, schedule.timezone);
  if (parts.weekday > 5) return false;
  return parts.hour >= schedule.workdayStartHour && parts.hour < schedule.workdayEndHour;
}

function nextWeekdayWorkdayStart(schedule: UserSchedule, now = new Date()): Date {
  const nowLocal = localParts(now, schedule.timezone);
  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const candidateLocal = addLocalDays({
      year: nowLocal.year,
      month: nowLocal.month,
      day: nowLocal.day,
      hour: schedule.workdayStartHour,
      minute: 0
    }, dayOffset);
    const candidate = localDateTimeToUtc(candidateLocal, schedule.timezone);
    const candidateParts = localParts(candidate, schedule.timezone);
    if (candidate > now && candidateParts.weekday <= 5) {
      return candidate;
    }
  }
  return new Date(now.getTime() + 12 * 60 * 60 * 1000);
}

function scheduleFromSettings(settings: AppSettings): UserSchedule | null {
  const schedule = scheduleWithConfigFallback(settings.setupDefaults);
  const timezone = schedule.timezone;
  const workdayStartHour = schedule.workdayStartHour;
  const workdayEndHour = schedule.workdayEndHour;
  if (!timezone || !Number.isFinite(workdayStartHour) || !Number.isFinite(workdayEndHour)) return null;
  return {
    timezone,
    workdayStartHour: Number(workdayStartHour),
    workdayEndHour: Number(workdayEndHour)
  };
}

function channelScopeForWorkspace(
  workspace: Workspace,
  defaults: SetupDefaults,
  workspaceCount: number
): { ok: true; channelScope: string[] } | { ok: false } {
  const configured = defaults.workspaceChannels?.find((entry) => entry.workspaceId === workspace.id);
  if (configured) {
    return configured.channelScopeMode === 'all_accessible'
      ? { ok: true, channelScope: [] }
      : configured.selectedChannels.length
        ? { ok: true, channelScope: configured.selectedChannels.map((channel) => channel.id) }
        : { ok: false };
  }

  const legacyApplies = defaults.workspaceId ? defaults.workspaceId === workspace.id : workspaceCount <= 1;
  if (!legacyApplies) return { ok: false };
  if (defaults.channelScopeMode === 'all_accessible') return { ok: true, channelScope: [] };
  const selected = defaults.selectedChannels ?? [];
  return selected.length ? { ok: true, channelScope: selected.map((channel) => channel.id) } : { ok: false };
}

function scheduledTargets(): Array<{ workspace: Workspace; channelScope: string[] }> {
  const store = getStore();
  const defaults = store.getAppSettings().setupDefaults;
  if (!defaults) return [];
  const workspaces = store.listWorkspaces();
  return workspaces.flatMap((workspace) => {
    const scope = channelScopeForWorkspace(workspace, defaults, workspaces.length);
    return scope.ok ? [{ workspace, channelScope: scope.channelScope }] : [];
  });
}

function emitStoppedSessions(sessions: AutopilotSession[]): void {
  for (const session of sessions) {
    emitControlPlaneEvent({ type: 'session.updated', session });
    emitControlPlaneEvent({ type: 'briefing.ready', sessionId: session.id });
  }
}

export async function runScheduleHeartbeat(now = new Date()): Promise<SchedulerTickResult> {
  const store = getStore();
  const schedule = scheduleFromSettings(store.getAppSettings());
  const targets = scheduledTargets();
  const result: SchedulerTickResult = {
    inspected: targets.length,
    started: 0,
    stopped: 0,
    skipped: 0
  };

  if (!schedule) {
    return { ...result, skipped: targets.length };
  }

  const inWorkHours = isWithinWeekdayWorkHours(schedule, now);
  const policy = inWorkHours ? null : await resolveSessionPolicy();

  for (const target of targets) {
    if (inWorkHours) {
      const stopped = store.stopScheduledSessions(target.workspace.id, now.toISOString());
      emitStoppedSessions(stopped);
      if (stopped.length > 0) {
        result.stopped += stopped.length;
        await syncSlackPresenceForWorkspace(target.workspace.id);
      } else {
        result.skipped += 1;
      }
      continue;
    }

    if (store.listActiveSessions(target.workspace.id).length > 0) {
      result.skipped += 1;
      await syncSlackPresenceForWorkspace(target.workspace.id);
      continue;
    }

    const session = store.createSession({
      workspaceId: target.workspace.id,
      title: 'Scheduled coverage',
      mode: policy!.mode,
      channelScope: target.channelScope,
      source: 'schedule',
      policyProfileName: policy!.policyProfileName,
      policy: policy!.policy,
      policyBinding: 'config',
      channelScopeBinding: 'setup_defaults',
      endsAt: nextWeekdayWorkdayStart(schedule, now).toISOString()
    });
    emitControlPlaneEvent({ type: 'session.updated', session });
    await syncSlackPresenceForWorkspace(target.workspace.id);
    result.started += 1;
  }

  return result;
}
