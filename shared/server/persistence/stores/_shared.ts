import type Database from 'better-sqlite3';

export type Db = Database.Database;

export function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

export function parseJsonObject<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return { ...fallback, ...(JSON.parse(value) as object) } as T;
  } catch {
    return fallback;
  }
}
