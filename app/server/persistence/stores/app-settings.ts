import type { AppSettings } from '#app/types';
import { normalizeProviderBotRoleMap, normalizeSetupBotRoles } from '#app/server/setup/bot-roles';
import type { Db } from './common.js';
import { parseJsonObject } from './common.js';

const SETTINGS_KEY = 'local';

function normalizeSettings(settings: AppSettings): AppSettings {
  const setupDefaults = settings.setupDefaults
    ? {
        botRoles: normalizeSetupBotRoles(settings.setupDefaults.botRoles),
        providerBotRoles: normalizeProviderBotRoleMap(settings.setupDefaults.providerBotRoles),
        channelProvider: settings.setupDefaults.channelProvider?.trim() || undefined,
        workspaceId: settings.setupDefaults.workspaceId?.trim() || undefined,
        ownerUserId: settings.setupDefaults.ownerUserId?.trim() || undefined,
        ownerDisplayName: settings.setupDefaults.ownerDisplayName?.trim() || undefined,
        workspaceOwners: (settings.setupDefaults.workspaceOwners ?? [])
          .map((owner) => ({
            workspaceId: owner.workspaceId?.trim(),
            ownerUserId: owner.ownerUserId?.trim(),
            ownerDisplayName: owner.ownerDisplayName?.trim() || owner.ownerUserId?.trim()
          }))
          .filter((owner): owner is { workspaceId: string; ownerUserId: string; ownerDisplayName: string } => (
            Boolean(owner.workspaceId && owner.ownerUserId)
          )),
        workspaceChannels: (settings.setupDefaults.workspaceChannels ?? [])
          .map((entry) => {
            const channelScopeMode = entry.channelScopeMode === 'all_accessible' ? 'all_accessible' as const : 'selected' as const;
            const selectedChannels = (entry.selectedChannels ?? [])
              .map((channel) => ({
                id: channel.id?.trim(),
                displayName: channel.displayName?.trim() || channel.id?.trim()
              }))
              .filter((channel): channel is { id: string; displayName: string } => Boolean(channel.id && channel.displayName));
            return {
              workspaceId: entry.workspaceId?.trim(),
              channelScopeMode,
              selectedChannels: channelScopeMode === 'selected' ? selectedChannels : []
            };
          })
          .filter((entry): entry is {
            workspaceId: string;
            channelScopeMode: 'selected' | 'all_accessible';
            selectedChannels: Array<{ id: string; displayName: string }>;
          } => Boolean(entry.workspaceId && (entry.channelScopeMode === 'all_accessible' || entry.selectedChannels.length > 0))),
        channelScopeMode: settings.setupDefaults.channelScopeMode === 'all_accessible' ? 'all_accessible' as const : 'selected' as const,
        selectedChannels: (settings.setupDefaults.selectedChannels ?? [])
          .map((channel) => ({
            id: channel.id?.trim(),
            displayName: channel.displayName?.trim() || channel.id?.trim()
          }))
          .filter((channel): channel is { id: string; displayName: string } => Boolean(channel.id && channel.displayName)),
        timezone: settings.setupDefaults.timezone?.trim() || undefined,
        workdayStartHour: Number.isFinite(settings.setupDefaults.workdayStartHour)
          ? settings.setupDefaults.workdayStartHour
          : undefined,
        workdayEndHour: Number.isFinite(settings.setupDefaults.workdayEndHour)
          ? settings.setupDefaults.workdayEndHour
          : undefined
      }
    : undefined;

  return {
    policyProfileName: settings.policyProfileName?.trim() || undefined,
    setupDefaults
  };
}

export function getAppSettings(db: Db): AppSettings {
  const row = db
    .prepare(`SELECT data_json FROM app_settings WHERE key = ?`)
    .get(SETTINGS_KEY) as { data_json: string } | undefined;

  if (!row) {
    const legacy = db
      .prepare(`SELECT data_json FROM workspace_memory ORDER BY workspace_id LIMIT 1`)
      .get() as { data_json: string } | undefined;
    const legacySettings = parseJsonObject<{ defaultPolicyProfileName?: string }>(
      legacy?.data_json,
      {}
    );
    return {
      policyProfileName: legacySettings.defaultPolicyProfileName?.trim() || undefined
    };
  }

  return normalizeSettings(parseJsonObject<AppSettings>(row.data_json, {}));
}

export function upsertAppSettings(db: Db, settings: AppSettings): AppSettings {
  const current = getAppSettings(db);
  const next = normalizeSettings({
    ...current,
    ...(Object.prototype.hasOwnProperty.call(settings, 'policyProfileName')
      ? { policyProfileName: settings.policyProfileName }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(settings, 'setupDefaults')
      ? { setupDefaults: settings.setupDefaults }
      : {})
  });

  db.prepare(
    `INSERT INTO app_settings (key, data_json)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json`
  ).run(SETTINGS_KEY, JSON.stringify(next));

  return next;
}
