import { columnNames, tableExists } from './helpers.js';
import type { Migration } from './types.js';

export const addBotInstallations: Migration = {
  id: '007_add_bot_installations',
  description: 'track provider bot installations by role',
  up(db) {
    if (!tableExists(db, 'bot_installations')) {
      db.exec(`
        CREATE TABLE bot_installations (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          role TEXT NOT NULL,
          external_workspace_id TEXT NOT NULL,
          bot_user_id TEXT,
          app_id TEXT,
          represented_user_id TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          installed_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(provider, external_workspace_id, role)
        );
      `);
    }

    if (tableExists(db, 'direct_conversations')) {
      const columns = columnNames(db, 'direct_conversations');
      if (!columns.has('bot_installation_id')) {
        db.exec(`ALTER TABLE direct_conversations ADD COLUMN bot_installation_id TEXT;`);
      }
    }

    db.exec(`
      INSERT OR IGNORE INTO bot_installations (
        id, workspace_id, provider, role, external_workspace_id, bot_user_id,
        app_id, represented_user_id, status, installed_at, updated_at
      )
      SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
             substr(lower(hex(randomblob(2))), 2) || '-' ||
             substr('89ab', abs(random()) % 4 + 1, 1) ||
             substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
             id,
             provider,
             'channel',
             external_workspace_id,
             bot_user_id,
             NULL,
             NULL,
             'active',
             installed_at,
             datetime('now')
      FROM workspaces;
    `);
  }
};
