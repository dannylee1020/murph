import type { ProviderName, ProviderSettings } from '#lib/types';
import type { Db } from './_shared.js';

export function upsertProviderSettings(db: Db, settings: ProviderSettings): void {
  db.prepare(
    `INSERT INTO provider_settings (workspace_id, provider, model)
     VALUES (?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       provider = excluded.provider,
       model = excluded.model`
  ).run(settings.workspaceId, settings.provider, settings.model);
}

export function getProviderSettings(db: Db, workspaceId: string): ProviderSettings | undefined {
  const row = db
    .prepare(`SELECT workspace_id, provider, model FROM provider_settings WHERE workspace_id = ?`)
    .get(workspaceId) as { workspace_id: string; provider: ProviderName; model: string } | undefined;

  if (!row) {
    return undefined;
  }

  return {
    workspaceId: row.workspace_id,
    provider: row.provider,
    model: row.model
  };
}
