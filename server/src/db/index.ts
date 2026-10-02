import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { config } from '../config.js';
import { SCHEMA_SQL } from './schema.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.imagesDir, { recursive: true });

export const db: DatabaseType = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.exec(SCHEMA_SQL);

/** Additive migrations for existing installs */
try {
  const cols = db.prepare(`PRAGMA table_info(generations)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'completed_at')) {
    db.exec(`ALTER TABLE generations ADD COLUMN completed_at INTEGER`);
  }
  if (!cols.some((c) => c.name === 'parent_id')) {
    db.exec(`ALTER TABLE generations ADD COLUMN parent_id TEXT`);
  }
} catch {
  // ignore
}
