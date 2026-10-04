import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { root } from './paths.js';

// Runs only inside the short-lived worker process (modelLinksWorker.js) — see modelLinksDb.js

const require = createRequire(import.meta.url);
// Same database as the server; DARKROOM_DATA_DIR points elsewhere (tests use a temp folder)
const dbPath = path.join(process.env.DARKROOM_DATA_DIR ? path.resolve(process.env.DARKROOM_DATA_DIR) : path.join(root, 'server', 'data'), 'darkroom.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS model_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  model_type TEXT NOT NULL,
  dest_path TEXT NOT NULL UNIQUE,
  source_path TEXT NOT NULL,
  link_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_model_links_filename ON model_links(filename);
`;

/** @type {import('better-sqlite3').Database | null} */
let cached = null;

function openDb() {
  if (cached) return cached;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const Database = require('better-sqlite3');
  cached = new Database(dbPath);
  cached.pragma('journal_mode = WAL');
  cached.exec(SCHEMA);
  return cached;
}

/**
 * @param {{
 *   filename: string,
 *   modelType: string,
 *   destPath: string,
 *   sourcePath: string,
 *   linkType: 'symlink' | 'hardlink',
 * }} row
 */
export function upsertModelLink(row) {
  const db = openDb();
  db.prepare(
    `INSERT INTO model_links (filename, model_type, dest_path, source_path, link_type, created_at)
     VALUES (@filename, @modelType, @destPath, @sourcePath, @linkType, @createdAt)
     ON CONFLICT(dest_path) DO UPDATE SET
       filename=excluded.filename,
       model_type=excluded.model_type,
       source_path=excluded.source_path,
       link_type=excluded.link_type,
       created_at=excluded.created_at`,
  ).run({
    filename: row.filename,
    modelType: row.modelType,
    destPath: path.resolve(row.destPath),
    sourcePath: path.resolve(row.sourcePath),
    linkType: row.linkType,
    createdAt: Date.now(),
  });
}

/** @param {string} destPath */
export function getModelLinkByDest(destPath) {
  const db = openDb();
  return (
    db
      .prepare(`SELECT * FROM model_links WHERE dest_path = ?`)
      .get(path.resolve(destPath)) || null
  );
}

/** @param {string} filename */
export function getModelLinkByFilename(filename) {
  const db = openDb();
  return db.prepare(`SELECT * FROM model_links WHERE filename = ?`).get(filename) || null;
}

/** @returns {Array<Record<string, unknown>>} */
export function listModelLinks() {
  const db = openDb();
  return db.prepare(`SELECT * FROM model_links ORDER BY created_at DESC`).all();
}

/** @param {string} destPath */
export function removeModelLinkByDest(destPath) {
  const db = openDb();
  db.prepare(`DELETE FROM model_links WHERE dest_path = ?`).run(path.resolve(destPath));
}

/**
 * @param {string} oldDest
 * @param {string} newDest
 * @param {string} newFilename
 */
export function renameModelLink(oldDest, newDest, newFilename) {
  const db = openDb();
  db.prepare(
    `UPDATE model_links SET dest_path = ?, filename = ? WHERE dest_path = ?`,
  ).run(path.resolve(newDest), newFilename, path.resolve(oldDest));
}

/**
 * @param {string} destPath
 * @param {string} sourcePath
 * @param {'symlink' | 'hardlink'} linkType
 */
export function updateModelLinkSource(destPath, sourcePath, linkType) {
  const db = openDb();
  db.prepare(
    `UPDATE model_links SET source_path = ?, link_type = ?, created_at = ? WHERE dest_path = ?`,
  ).run(path.resolve(sourcePath), linkType, Date.now(), path.resolve(destPath));
}

export function getModelLinksDbPath() {
  return dbPath;
}

/**
 * A folder of linked models moved (e.g. ComfyUI into dependencies/): rewrite the paths
 * that started with `from` so they start with `to`. Returns how many rows changed.
 * @param {string} from
 * @param {string} to
 */
export function rebaseModelLinks(from, to) {
  if (!fs.existsSync(dbPath)) return 0;
  const db = openDb();
  const rows = /** @type {Array<{ id: number, dest_path: string, source_path: string }>} */ (
    db.prepare('SELECT id, dest_path, source_path FROM model_links').all()
  );
  const swap = (/** @type {string} */ p) => (p === from || p.startsWith(from + path.sep) ? to + p.slice(from.length) : p);
  const update = db.prepare('UPDATE model_links SET dest_path = ?, source_path = ? WHERE id = ?');
  let n = 0;
  for (const r of rows) {
    const dest = swap(r.dest_path);
    const src = swap(r.source_path);
    if (dest !== r.dest_path || src !== r.source_path) {
      update.run(dest, src, r.id);
      n++;
    }
  }
  return n;
}
