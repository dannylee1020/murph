import { randomUUID } from 'node:crypto';
import type { Db } from './common.js';
import { parseJsonObject } from './common.js';

export type IntegrationCredentialStatus = 'connected' | 'error';

export interface IntegrationConnection {
  id: string;
  workspaceId: string;
  provider: string;
  credentialKind: string;
  metadata: Record<string, unknown>;
  status: IntegrationCredentialStatus;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveIntegrationConnectionInput {
  workspaceId: string;
  provider: string;
  credentialKind: string;
  metadata?: Record<string, unknown>;
  status?: IntegrationCredentialStatus;
  errorMessage?: string;
}

interface IntegrationCredentialRow {
  id: string;
  workspace_id: string;
  provider: string;
  credential_kind: string;
  metadata_json?: string | null;
  status: IntegrationCredentialStatus;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

function mapCredential(row: IntegrationCredentialRow): IntegrationConnection {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    credentialKind: row.credential_kind,
    metadata: parseJsonObject(row.metadata_json, {}),
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function saveCredential(db: Db, input: SaveIntegrationConnectionInput): IntegrationConnection {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO integration_connections
       (id, workspace_id, provider, credential_kind, metadata_json, status, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, provider) DO UPDATE SET
       credential_kind = excluded.credential_kind,
       metadata_json = excluded.metadata_json,
       status = excluded.status,
       error_message = excluded.error_message,
       updated_at = excluded.updated_at`
  ).run(
    id,
    input.workspaceId,
    input.provider,
    input.credentialKind,
    JSON.stringify(input.metadata ?? {}),
    input.status ?? 'connected',
    input.errorMessage ?? null,
    now,
    now
  );

  return getCredential(db, input.workspaceId, input.provider)!;
}

export function getCredential(db: Db, workspaceId: string, provider: string): IntegrationConnection | undefined {
  const row = db
    .prepare(
      `SELECT id, workspace_id, provider, credential_kind, metadata_json, status, error_message, created_at, updated_at
       FROM integration_connections
       WHERE workspace_id = ? AND provider = ?`
    )
    .get(workspaceId, provider) as IntegrationCredentialRow | undefined;
  return row ? mapCredential(row) : undefined;
}

export function listCredentials(db: Db, workspaceId: string): IntegrationConnection[] {
  const rows = db
    .prepare(
      `SELECT id, workspace_id, provider, credential_kind, metadata_json, status, error_message, created_at, updated_at
       FROM integration_connections
       WHERE workspace_id = ?
       ORDER BY provider`
    )
    .all(workspaceId) as IntegrationCredentialRow[];
  return rows.map(mapCredential);
}

export function deleteCredential(db: Db, workspaceId: string, provider: string): boolean {
  const result = db
    .prepare(`DELETE FROM integration_connections WHERE workspace_id = ? AND provider = ?`)
    .run(workspaceId, provider);
  return result.changes > 0;
}
