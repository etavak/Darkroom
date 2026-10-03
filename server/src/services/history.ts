import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { db } from '../db/index.js';
import type { GenerationSettings } from '../workflow/index.js';
import { disposeFile } from './appSettings.js';

export type GenerationRow = {
  id: string;
  created_at: number;
  prompt_id: string;
  client_id: string;
  settings_json: string;
  image_paths_json: string;
  status: string;
  error: string | null;
  completed_at: number | null;
  parent_id: string | null;
  downloaded_json?: string;
};

export type GenerationDto = {
  id: string;
  createdAt: number;
  promptId: string;
  clientId: string;
  settings: GenerationSettings;
  images: string[];
  status: string;
  error: string | null;
  completedAt: number | null;
  durationMs: number | null;
  parentId: string | null;
  /** Images of this generation the user has downloaded */
  downloaded: string[];
};

function rowToDto(row: GenerationRow): GenerationDto {
  const completedAt = row.completed_at ?? null;
  return {
    id: row.id,
    createdAt: row.created_at,
    promptId: row.prompt_id,
    clientId: row.client_id,
    settings: JSON.parse(row.settings_json) as GenerationSettings,
    images: JSON.parse(row.image_paths_json) as string[],
    status: row.status,
    error: row.error,
    completedAt,
    durationMs:
      completedAt != null && completedAt >= row.created_at
        ? completedAt - row.created_at
        : null,
    parentId: row.parent_id ?? null,
    downloaded: parseList(row.downloaded_json),
  };
}

function parseList(json: string | undefined): string[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function createGeneration(params: {
  promptId: string;
  clientId: string;
  settings: GenerationSettings;
  parentId?: string | null;
}): GenerationDto {
  const id = uuidv4();
  const createdAt = Date.now();
  const parentId = params.parentId ?? params.settings.parentId ?? null;
  db.prepare(
    `INSERT INTO generations (id, created_at, prompt_id, client_id, settings_json, image_paths_json, status, parent_id)
     VALUES (?, ?, ?, ?, ?, '[]', 'pending', ?)`,
  ).run(
    id,
    createdAt,
    params.promptId,
    params.clientId,
    JSON.stringify(params.settings),
    parentId,
  );

  return {
    id,
    createdAt,
    promptId: params.promptId,
    clientId: params.clientId,
    settings: params.settings,
    images: [],
    status: 'pending',
    error: null,
    completedAt: null,
    durationMs: null,
    parentId,
    downloaded: [],
  };
}

/**
 * Completed generations, newest first, a page at a time: `before` is the createdAt of the
 * oldest one already loaded. `total` counts all of them.
 */
export function listGenerations(limit = 200, before?: { at: number; id: string }): { items: GenerationDto[]; hasMore: boolean; total: number } {
  const n = Math.min(Math.max(Math.floor(limit), 1), 1000);
  // (created_at, id) cursor: generations made in the same millisecond aren't skipped
  const rows = (
    before
      ? db
          .prepare(
            `SELECT * FROM generations WHERE status = 'completed' AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(before.at, before.at, before.id, n + 1)
      : db.prepare(`SELECT * FROM generations WHERE status = 'completed' ORDER BY created_at DESC, id DESC LIMIT ?`).all(n + 1)
  ) as GenerationRow[];
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM generations WHERE status = 'completed'`).get() as { n: number }).n;
  return { items: rows.slice(0, n).map(rowToDto), hasMore: rows.length > n, total };
}

export function listPendingGenerations(): GenerationDto[] {
  const rows = db
    .prepare(`SELECT * FROM generations WHERE status = 'pending' ORDER BY created_at ASC`)
    .all() as GenerationRow[];
  return rows.map(rowToDto);
}

export function getGeneration(id: string): GenerationDto | null {
  const row = db.prepare(`SELECT * FROM generations WHERE id = ?`).get(id) as
    | GenerationRow
    | undefined;
  return row ? rowToDto(row) : null;
}

export function markCompleted(id: string, imagePaths: string[]): GenerationDto | null {
  const completedAt = Date.now();
  db.prepare(
    `UPDATE generations SET status = 'completed', image_paths_json = ?, error = NULL, completed_at = ? WHERE id = ?`,
  ).run(JSON.stringify(imagePaths), completedAt, id);
  return getGeneration(id);
}

export function markFailed(id: string, error: string): void {
  db.prepare(`UPDATE generations SET status = 'failed', error = ? WHERE id = ?`).run(error, id);
}

export function deleteGeneration(id: string): boolean {
  const row = getGeneration(id);
  if (!row) return false;

  for (const filename of row.images) {
    try {
      disposeFile(filename);
    } catch {
      // ignore missing files
    }
  }

  db.prepare(`DELETE FROM generations WHERE id = ?`).run(id);
  return true;
}

/** Remember that these image files were downloaded (by name). Returns how many were found. */
export function markDownloaded(images: string[]): number {
  const wanted = new Set(images.map((n) => path.basename(n)));
  if (!wanted.size) return 0;
  const rows = db.prepare(`SELECT id, image_paths_json, downloaded_json FROM generations WHERE status = 'completed'`).all() as GenerationRow[];
  const update = db.prepare(`UPDATE generations SET downloaded_json = ? WHERE id = ?`);
  let found = 0;
  db.transaction(() => {
    for (const row of rows) {
      const imgs = parseList(row.image_paths_json).filter((n) => wanted.has(n));
      if (!imgs.length) continue;
      const done = new Set(parseList(row.downloaded_json));
      imgs.forEach((n) => done.add(n));
      update.run(JSON.stringify([...done]), row.id);
      found += imgs.length;
    }
  })();
  return found;
}

type UnsavedPlan = Array<{ id: string; drop: string[]; keep: string[] }>;

/** Images never downloaded, outside the kept (pinned) generations. */
function unsavedPlan(keepIds: Set<string>): UnsavedPlan {
  const rows = db.prepare(`SELECT id, image_paths_json, downloaded_json FROM generations WHERE status = 'completed'`).all() as GenerationRow[];
  const plan: UnsavedPlan = [];
  for (const row of rows) {
    if (keepIds.has(row.id)) continue;
    const done = new Set(parseList(row.downloaded_json));
    const imgs = parseList(row.image_paths_json);
    const drop = imgs.filter((n) => !done.has(n));
    if (drop.length) plan.push({ id: row.id, drop, keep: imgs.filter((n) => done.has(n)) });
  }
  return plan;
}

const fileSize = (name: string) => fs.statSync(path.join(config.imagesDir, path.basename(name)), { throwIfNoEntry: false })?.size ?? 0;

export function unsavedSummary(keepIds: Set<string>): { images: number; generations: number; bytes: number } {
  const plan = unsavedPlan(keepIds);
  const images = plan.flatMap((p) => p.drop);
  return { images: images.length, generations: plan.length, bytes: images.reduce((a, n) => a + fileSize(n), 0) };
}

/**
 * Permanently deletes (no trash) every image that was never downloaded, except in kept
 * generations. A generation with downloaded images keeps just those.
 */
export function purgeUnsaved(keepIds: Set<string>): { images: number; generations: number; bytes: number } {
  const plan = unsavedPlan(keepIds);
  let images = 0;
  let bytes = 0;
  const del = db.prepare(`DELETE FROM generations WHERE id = ?`);
  const trim = db.prepare(`UPDATE generations SET image_paths_json = ? WHERE id = ?`);
  for (const p of plan) {
    for (const name of p.drop) {
      const file = path.join(config.imagesDir, path.basename(name));
      const size = fileSize(name);
      try {
        fs.unlinkSync(file);
      } catch {
        // already gone
      }
      images += 1;
      bytes += size;
    }
    if (p.keep.length) trim.run(JSON.stringify(p.keep), p.id);
    else del.run(p.id);
  }
  return { images, generations: plan.length, bytes };
}
