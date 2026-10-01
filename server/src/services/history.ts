import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { db } from '../db/index.js';
import type { GenerationSettings } from '../workflow/index.js';

export type GenerationRow = {
  id: string;
  created_at: number;
  prompt_id: string;
  client_id: string;
  settings_json: string;
  image_paths_json: string;
  status: string;
  error: string | null;
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
};

function rowToDto(row: GenerationRow): GenerationDto {
  return {
    id: row.id,
    createdAt: row.created_at,
    promptId: row.prompt_id,
    clientId: row.client_id,
    settings: JSON.parse(row.settings_json) as GenerationSettings,
    images: JSON.parse(row.image_paths_json) as string[],
    status: row.status,
    error: row.error,
  };
}

export function createGeneration(params: {
  promptId: string;
  clientId: string;
  settings: GenerationSettings;
}): GenerationDto {
  const id = uuidv4();
  const createdAt = Date.now();
  db.prepare(
    `INSERT INTO generations (id, created_at, prompt_id, client_id, settings_json, image_paths_json, status)
     VALUES (?, ?, ?, ?, ?, '[]', 'pending')`,
  ).run(id, createdAt, params.promptId, params.clientId, JSON.stringify(params.settings));

  return {
    id,
    createdAt,
    promptId: params.promptId,
    clientId: params.clientId,
    settings: params.settings,
    images: [],
    status: 'pending',
    error: null,
  };
}

export function listGenerations(limit = 100): GenerationDto[] {
  const rows = db
    .prepare(
      `SELECT * FROM generations WHERE status = 'completed' ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as GenerationRow[];
  return rows.map(rowToDto);
}

export function getGeneration(id: string): GenerationDto | null {
  const row = db.prepare(`SELECT * FROM generations WHERE id = ?`).get(id) as
    | GenerationRow
    | undefined;
  return row ? rowToDto(row) : null;
}

export function getGenerationByPromptId(promptId: string): GenerationDto | null {
  const row = db.prepare(`SELECT * FROM generations WHERE prompt_id = ?`).get(promptId) as
    | GenerationRow
    | undefined;
  return row ? rowToDto(row) : null;
}

export function markCompleted(id: string, imagePaths: string[]): GenerationDto | null {
  db.prepare(
    `UPDATE generations SET status = 'completed', image_paths_json = ?, error = NULL WHERE id = ?`,
  ).run(JSON.stringify(imagePaths), id);
  return getGeneration(id);
}

export function markFailed(id: string, error: string): void {
  db.prepare(`UPDATE generations SET status = 'failed', error = ? WHERE id = ?`).run(error, id);
}

export function deleteGeneration(id: string): boolean {
  const row = getGeneration(id);
  if (!row) return false;

  for (const filename of row.images) {
    const filePath = path.join(config.imagesDir, filename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore missing files
    }
  }

  db.prepare(`DELETE FROM generations WHERE id = ?`).run(id);
  return true;
}
