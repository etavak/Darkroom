import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckpointMapping, CheckpointsFile, FamilyDef } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const presetsRoot = path.resolve(__dirname, '../../presets');
export const familiesDir = path.join(presetsRoot, 'families');
/** Shipped default mappings for well-known filenames (read-only at runtime). */
export const checkpointsPath = path.join(presetsRoot, 'checkpoints.json');
/** The user's own filename → family mappings (survives updates). */
export const userCheckpointsPath = path.resolve(__dirname, '../../data/checkpoints.json');

function isFamilyDef(v: unknown): v is FamilyDef {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.defaultStyle === 'string' &&
    o.styles !== null &&
    typeof o.styles === 'object'
  );
}

let familyCache: FamilyDef[] | null = null;
let mappingCache: CheckpointsFile | null = null;
let mappingCacheKey = '';

export function invalidatePresetCache(): void {
  familyCache = null;
  mappingCache = null;
}

export function listFamilies(): FamilyDef[] {
  if (familyCache) return familyCache;
  if (!fs.existsSync(familiesDir)) {
    familyCache = [];
    return familyCache;
  }
  const files = fs.readdirSync(familiesDir).filter((f) => f.endsWith('.json'));
  const out: FamilyDef[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(familiesDir, file), 'utf8')) as unknown;
      if (!isFamilyDef(raw)) {
        console.warn(`[presets] skip invalid family ${file}`);
        continue;
      }
      out.push(raw);
    } catch (err) {
      console.warn(`[presets] failed to load ${file}:`, err);
    }
  }
  familyCache = out.sort((a, b) => a.name.localeCompare(b.name));
  return familyCache;
}

export function getFamily(id: string): FamilyDef | null {
  return listFamilies().find((f) => f.id === id) ?? null;
}

function readMappingsAt(file: string): CheckpointsFile['mappings'] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as CheckpointsFile;
    return raw.mappings ?? {};
  } catch {
    return {};
  }
}

/**
 * Older builds wrote user mappings into the shipped presets file. Copy it once
 * into server/data so those mappings survive updates that replace presets/.
 */
function migrateUserMappings(): void {
  if (fs.existsSync(userCheckpointsPath) || !fs.existsSync(checkpointsPath)) return;
  fs.mkdirSync(path.dirname(userCheckpointsPath), { recursive: true });
  fs.writeFileSync(
    userCheckpointsPath,
    JSON.stringify({ mappings: readMappingsAt(checkpointsPath) }, null, 2) + '\n',
    'utf8',
  );
}

/** Shipped defaults (presets/) overlaid with the user's own mappings (data/). */
function readCheckpointsFile(): CheckpointsFile {
  migrateUserMappings();
  const mtime = (f: string) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);
  // The CLI edits the user file too — reload when either file changes on disk
  const key = `${mtime(checkpointsPath)}:${mtime(userCheckpointsPath)}`;
  if (mappingCache && mappingCacheKey === key) return mappingCache;
  mappingCache = {
    mappings: { ...readMappingsAt(checkpointsPath), ...readMappingsAt(userCheckpointsPath) },
  };
  mappingCacheKey = key;
  return mappingCache;
}

export function getCheckpointMapping(filename: string): CheckpointMapping | null {
  const file = readCheckpointsFile();
  return file.mappings[filename] ?? null;
}

export function listCheckpointMappings(): CheckpointsFile {
  return readCheckpointsFile();
}

/** Persist filename → family mapping (and optional override layer fields). */
export function saveCheckpointMapping(
  filename: string,
  mapping: CheckpointMapping,
): CheckpointMapping {
  if (!getFamily(mapping.family)) {
    throw new Error(`Unknown family: ${mapping.family}`);
  }
  migrateUserMappings();
  const next: CheckpointsFile = {
    mappings: { ...readMappingsAt(userCheckpointsPath), [filename]: mapping },
  };
  fs.mkdirSync(path.dirname(userCheckpointsPath), { recursive: true });
  fs.writeFileSync(userCheckpointsPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  mappingCache = null;
  return mapping;
}
