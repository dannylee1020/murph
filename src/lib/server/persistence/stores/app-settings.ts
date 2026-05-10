import type { AppSettings } from '#lib/types';
import type { Db } from './_shared.js';
import { parseJsonObject } from './_shared.js';

const SETTINGS_KEY = 'local';

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

  return parseJsonObject<AppSettings>(row.data_json, {});
}

export function upsertAppSettings(db: Db, settings: AppSettings): AppSettings {
  const next: AppSettings = {
    policyProfileName: settings.policyProfileName?.trim() || undefined
  };

  db.prepare(
    `INSERT INTO app_settings (key, data_json)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json`
  ).run(SETTINGS_KEY, JSON.stringify(next));

  return next;
}
