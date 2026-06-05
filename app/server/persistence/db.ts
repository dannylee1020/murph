import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getRuntimeEnv } from '#app/server/util/env';
import { runMigrations } from './migrator.js';

let database: Database.Database | null = null;

export function getDb(): Database.Database {
  if (database) {
    return database;
  }

  const { sqlitePath } = getRuntimeEnv();
  mkdirSync(path.dirname(sqlitePath), { recursive: true });
  database = new Database(sqlitePath);
  database.exec('PRAGMA journal_mode = WAL;');
  runMigrations(database, sqlitePath);

  return database;
}
