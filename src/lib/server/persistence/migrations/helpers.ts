import type Database from 'better-sqlite3';

export function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

export function columnNames(db: Database.Database, table: string): Set<string> {
  if (!tableExists(db, table)) {
    return new Set();
  }
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((entry) => entry.name));
}

export function hasAnyColumn(db: Database.Database, table: string, columns: string[]): boolean {
  const existing = columnNames(db, table);
  return columns.some((column) => existing.has(column));
}

export function sqlColumn(columns: Set<string>, name: string, fallback: string): string {
  return columns.has(name) ? name : fallback;
}
