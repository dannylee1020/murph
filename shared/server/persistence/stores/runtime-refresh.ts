import type { Db } from './_shared.js';
import { parseJsonArray, parseJsonObject } from './_shared.js';

export interface RuntimeRefreshState {
  scopeKey: string;
  pending: boolean;
  pendingReasons: string[];
  lastRevisionJson?: string;
  updatedAt: string;
}

interface RuntimeRefreshStateRow {
  scope_key: string;
  pending: number;
  pending_reasons_json: string;
  last_revision_json?: string;
  updated_at: string;
}

function mapState(row: RuntimeRefreshStateRow): RuntimeRefreshState {
  return {
    scopeKey: row.scope_key,
    pending: row.pending === 1,
    pendingReasons: parseJsonArray(row.pending_reasons_json),
    lastRevisionJson: row.last_revision_json,
    updatedAt: row.updated_at
  };
}

export function getRuntimeRefreshState(db: Db, scopeKey: string): RuntimeRefreshState | undefined {
  const row = db
    .prepare(`SELECT * FROM runtime_refresh_state WHERE scope_key = ?`)
    .get(scopeKey) as RuntimeRefreshStateRow | undefined;
  return row ? mapState(row) : undefined;
}

export function markRuntimeRefreshPending(db: Db, scopeKey: string, reason: string): RuntimeRefreshState {
  const existing = getRuntimeRefreshState(db, scopeKey);
  const pendingReasons = [...new Set([...(existing?.pendingReasons ?? []), reason])];
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO runtime_refresh_state (
       scope_key, pending, pending_reasons_json, last_revision_json, updated_at
     ) VALUES (?, 1, ?, ?, ?)
     ON CONFLICT(scope_key) DO UPDATE SET
       pending = 1,
       pending_reasons_json = excluded.pending_reasons_json,
       updated_at = excluded.updated_at`
  ).run(scopeKey, JSON.stringify(pendingReasons), existing?.lastRevisionJson ?? null, updatedAt);
  return getRuntimeRefreshState(db, scopeKey)!;
}

export function setRuntimeRefreshState(
  db: Db,
  scopeKey: string,
  input: {
    pending?: boolean;
    pendingReasons?: string[];
    lastRevisionJson?: string;
  }
): RuntimeRefreshState {
  const existing = getRuntimeRefreshState(db, scopeKey);
  const updatedAt = new Date().toISOString();
  const pending = input.pending ?? existing?.pending ?? false;
  const pendingReasons = input.pendingReasons ?? existing?.pendingReasons ?? [];
  const lastRevisionJson = Object.prototype.hasOwnProperty.call(input, 'lastRevisionJson')
    ? input.lastRevisionJson
    : existing?.lastRevisionJson;

  db.prepare(
    `INSERT INTO runtime_refresh_state (
       scope_key, pending, pending_reasons_json, last_revision_json, updated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(scope_key) DO UPDATE SET
       pending = excluded.pending,
       pending_reasons_json = excluded.pending_reasons_json,
       last_revision_json = excluded.last_revision_json,
       updated_at = excluded.updated_at`
  ).run(
    scopeKey,
    pending ? 1 : 0,
    JSON.stringify(pendingReasons),
    lastRevisionJson ?? null,
    updatedAt
  );

  return getRuntimeRefreshState(db, scopeKey)!;
}

export function parseRuntimeRevision(value: string | undefined): Record<string, unknown> | undefined {
  return value ? parseJsonObject<Record<string, unknown>>(value, {}) : undefined;
}
