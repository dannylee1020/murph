import { existsSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { migrations } from './migrations/index.js';
import type { Migration } from './migrations/types.js';

function appliedMigrationIds(db: Database.Database): Set<string> {
  const rows = db.prepare(`SELECT id FROM schema_migrations`).all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function backupPath(sqlitePath: string, migrationId: string): string {
  const parsed = path.parse(sqlitePath);
  return path.join(parsed.dir, `${parsed.base}.before-${migrationId}.bak`);
}

function createBackup(db: Database.Database, sqlitePath: string, migration: Migration): void {
  if (sqlitePath === ':memory:' || !existsSync(sqlitePath)) {
    return;
  }

  const destination = backupPath(sqlitePath, migration.id);
  if (existsSync(destination)) {
    return;
  }

  db.exec(`VACUUM INTO ${sqlString(destination)}`);
}

function shouldCreateBackup(db: Database.Database, migration: Migration): boolean {
  if (!migration.destructive) {
    return false;
  }
  return migration.shouldBackup ? migration.shouldBackup(db) : true;
}

function applyMigration(db: Database.Database, sqlitePath: string, migration: Migration): void {
  if (shouldCreateBackup(db, migration)) {
    createBackup(db, sqlitePath, migration);
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    migration.up(db);
    db
      .prepare(`INSERT INTO schema_migrations (id, description, applied_at) VALUES (?, ?, ?)`)
      .run(migration.id, migration.description, new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function runMigrationList(
  db: Database.Database,
  sqlitePath: string,
  migrationList: Migration[]
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = appliedMigrationIds(db);
  for (const migration of migrationList) {
    if (applied.has(migration.id)) {
      continue;
    }
    applyMigration(db, sqlitePath, migration);
    applied.add(migration.id);
  }
}

export function runMigrations(db: Database.Database, sqlitePath: string): void {
  runMigrationList(db, sqlitePath, migrations);
}
