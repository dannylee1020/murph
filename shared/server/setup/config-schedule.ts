import { getStore } from '#shared/server/persistence/store';
import { readMurphConfig } from '#shared/server/setup/config-file';
import type { SetupDefaults, UserSchedule } from '#shared/types';

export type ConfigSchedule = Partial<UserSchedule>;

export function readConfigSchedule(): ConfigSchedule {
  const app = readMurphConfig().app ?? {};
  return {
    timezone: app.timezone,
    workdayStartHour: app.workdayStartHour,
    workdayEndHour: app.workdayEndHour
  };
}

export function configScheduleConfigured(schedule = readConfigSchedule()): boolean {
  return Boolean(
    schedule.timezone &&
      Number.isFinite(schedule.workdayStartHour) &&
      Number.isFinite(schedule.workdayEndHour)
  );
}

export function scheduleWithConfigFallback(defaults?: SetupDefaults): ConfigSchedule {
  const schedule = readConfigSchedule();
  return {
    timezone: schedule.timezone ?? defaults?.timezone,
    workdayStartHour: schedule.workdayStartHour ?? defaults?.workdayStartHour,
    workdayEndHour: schedule.workdayEndHour ?? defaults?.workdayEndHour
  };
}

export function syncConfigScheduleToSetupOwners(): void {
  const schedule = readConfigSchedule();
  if (!configScheduleConfigured(schedule)) return;

  const store = getStore();
  const defaults = store.getAppSettings().setupDefaults;
  const owners = new Map<string, { workspaceId: string; ownerUserId: string; ownerDisplayName?: string }>();

  if (defaults?.workspaceId && defaults.ownerUserId) {
    owners.set(defaults.workspaceId, {
      workspaceId: defaults.workspaceId,
      ownerUserId: defaults.ownerUserId,
      ownerDisplayName: defaults.ownerDisplayName
    });
  }

  for (const owner of defaults?.workspaceOwners ?? []) {
    if (!owner.workspaceId || !owner.ownerUserId) continue;
    owners.set(owner.workspaceId, owner);
  }

  for (const owner of owners.values()) {
    const workspace = store.getWorkspaceById(owner.workspaceId);
    if (!workspace) continue;
    const user = store.upsertUser({
      workspaceId: owner.workspaceId,
      externalUserId: owner.ownerUserId,
      displayName: owner.ownerDisplayName ?? owner.ownerUserId,
      timezone: schedule.timezone,
      workdayStartHour: schedule.workdayStartHour,
      workdayEndHour: schedule.workdayEndHour
    });
    const subscription = store.getWorkspaceSubscription(owner.workspaceId, owner.ownerUserId);
    if (!subscription) continue;
    store.upsertWorkspaceSubscription({
      workspaceId: subscription.workspaceId,
      provider: subscription.provider,
      externalUserId: subscription.externalUserId,
      displayName: subscription.displayName,
      status: subscription.status,
      channelScopeMode: subscription.channelScopeMode,
      channelScope: subscription.channelScope,
      schedule: user.schedule,
      policyProfileName: subscription.policyProfileName,
      policyMode: subscription.policyMode,
      dashboardTokenHash: subscription.dashboardTokenHash
    });
  }
}
