import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { murphHome } from '#app/server/setup/paths';

export interface CredentialRecord {
  provider: string;
  key: string;
  value: string;
  workspaceId?: string;
  externalWorkspaceId?: string;
  botInstallationId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface CredentialFile {
  version: 1;
  credentials: CredentialRecord[];
}

export interface SecretRef {
  workspaceId?: string;
  externalWorkspaceId?: string;
  botInstallationId?: string;
  userId?: string;
}

export interface WriteSecretOptions extends SecretRef {
  metadata?: Record<string, unknown>;
}

export function credentialsPath(): string {
  if (process.env.VITEST && !process.env.MURPH_CREDENTIALS_PATH && !process.env.MURPH_HOME) {
    return path.join(tmpdir(), 'murph-vitest-empty-credentials.json');
  }
  return process.env.MURPH_CREDENTIALS_PATH || path.join(murphHome(), '.credentials');
}

function emptyFile(): CredentialFile {
  return { version: 1, credentials: [] };
}

function normalizeCredentialFile(value: unknown): CredentialFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptyFile();
  }

  const raw = value as Partial<CredentialFile>;
  const credentials = Array.isArray(raw.credentials)
    ? raw.credentials.filter((entry): entry is CredentialRecord => (
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof entry.provider === 'string' &&
        typeof entry.key === 'string' &&
        typeof entry.value === 'string'
      ))
    : [];

  return { version: 1, credentials };
}

export function readCredentialFile(): CredentialFile {
  const target = credentialsPath();
  if (!existsSync(target)) {
    return emptyFile();
  }

  const raw = readFileSync(target, 'utf8').trim();
  if (!raw) {
    return emptyFile();
  }

  return normalizeCredentialFile(JSON.parse(raw));
}

function writeCredentialFile(file: CredentialFile): void {
  const target = credentialsPath();
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(target, 0o600);
}

function refMatches(record: CredentialRecord, ref: SecretRef = {}): boolean {
  if (
    ref.workspaceId === undefined &&
    ref.externalWorkspaceId === undefined &&
    ref.botInstallationId === undefined &&
    ref.userId === undefined
  ) {
    return record.workspaceId === undefined &&
      record.externalWorkspaceId === undefined &&
      record.botInstallationId === undefined &&
      record.userId === undefined;
  }

  return (
    (ref.workspaceId === undefined || record.workspaceId === ref.workspaceId) &&
    (ref.externalWorkspaceId === undefined || record.externalWorkspaceId === ref.externalWorkspaceId) &&
    (ref.botInstallationId === undefined || record.botInstallationId === ref.botInstallationId) &&
    (ref.userId === undefined || record.userId === ref.userId)
  );
}

function exactRefMatches(record: CredentialRecord, ref: SecretRef = {}): boolean {
  return (
    (record.workspaceId ?? '') === (ref.workspaceId ?? '') &&
    (record.externalWorkspaceId ?? '') === (ref.externalWorkspaceId ?? '') &&
    (record.botInstallationId ?? '') === (ref.botInstallationId ?? '') &&
    (record.userId ?? '') === (ref.userId ?? '')
  );
}

function hasCredentialValue(record: CredentialRecord): boolean {
  return record.value.trim().length > 0;
}

export function listSecrets(): CredentialRecord[] {
  return readCredentialFile().credentials;
}

export function readSecret(provider: string, key: string, ref: SecretRef = {}): string | undefined {
  const candidates = readCredentialFile().credentials
    .filter((record) => record.provider === provider && record.key === key && refMatches(record, ref) && hasCredentialValue(record));

  candidates.sort((a, b) => {
    const aScore = Number(Boolean(a.workspaceId)) + Number(Boolean(a.externalWorkspaceId)) + Number(Boolean(a.botInstallationId)) + Number(Boolean(a.userId));
    const bScore = Number(Boolean(b.workspaceId)) + Number(Boolean(b.externalWorkspaceId)) + Number(Boolean(b.botInstallationId)) + Number(Boolean(b.userId));
    return bScore - aScore;
  });

  return candidates[0]?.value.trim();
}

export function readSecretRecord(provider: string, key: string, ref: SecretRef = {}): CredentialRecord | undefined {
  const record = readCredentialFile().credentials
    .filter((entry) => entry.provider === provider && entry.key === key && refMatches(entry, ref) && hasCredentialValue(entry))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return record
    ? { ...record, value: record.value.trim() }
    : undefined;
}

export function hasSecret(provider: string, key: string, ref: SecretRef = {}): boolean {
  return readSecret(provider, key, ref) !== undefined;
}

export function writeSecret(provider: string, key: string, value: string, options: WriteSecretOptions = {}): CredentialRecord {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Cannot store empty credential: ${provider}.${key}`);
  }

  const file = readCredentialFile();
  const now = new Date().toISOString();
  const existing = file.credentials.find((record) => (
    record.provider === provider &&
    record.key === key &&
    exactRefMatches(record, options)
  ));

  const next: CredentialRecord = {
    provider,
    key,
    value: trimmed,
    workspaceId: options.workspaceId,
    externalWorkspaceId: options.externalWorkspaceId,
    botInstallationId: options.botInstallationId,
    userId: options.userId,
    metadata: options.metadata,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  if (existing) {
    Object.assign(existing, next);
  } else {
    file.credentials.push(next);
  }

  writeCredentialFile(file);
  return next;
}

export function deleteSecret(provider: string, key: string, ref: SecretRef = {}): boolean {
  const file = readCredentialFile();
  const before = file.credentials.length;
  file.credentials = file.credentials.filter((record) => !(
    record.provider === provider &&
    record.key === key &&
    refMatches(record, ref)
  ));

  if (file.credentials.length !== before) {
    writeCredentialFile(file);
    return true;
  }

  return false;
}

export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return '****';
  }
  return `****${trimmed.slice(-4)}`;
}
