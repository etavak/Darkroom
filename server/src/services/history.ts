import { v4 as uuidv4 } from 'uuid';
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
  };
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

export function getGenerationByPromptId(promptId: string): GenerationDto | null {
  const row = db.prepare(`SELECT * FROM generations WHERE prompt_id = ?`).get(promptId) as
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
