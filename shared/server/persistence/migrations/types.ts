import type Database from 'better-sqlite3';

export interface Migration {
  id: string;
  description: string;
  destructive?: boolean;
  shouldBackup?: (db: Database.Database) => boolean;
  up(db: Database.Database): void;
}
