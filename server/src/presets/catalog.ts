import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckpointMapping, CheckpointsFile, FamilyDef } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const presetsRoot = path.resolve(__dirname, '../../presets');
export const familiesDir = path.join(presetsRoot, 'families');
export const checkpointsPath = path.join(presetsRoot, 'checkpoints.json');

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

function readCheckpointsFile(): CheckpointsFile {
  if (mappingCache) return mappingCache;
  if (!fs.existsSync(checkpointsPath)) {
    mappingCache = { mappings: {} };
    return mappingCache;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(checkpointsPath, 'utf8')) as CheckpointsFile;
    mappingCache = { mappings: raw.mappings ?? {} };
  } catch {
    mappingCache = { mappings: {} };
  }
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
  const file = readCheckpointsFile();
  const next: CheckpointsFile = {
    mappings: {
      ...file.mappings,
      [filename]: mapping,
    },
  };
  fs.mkdirSync(presetsRoot, { recursive: true });
  fs.writeFileSync(checkpointsPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  mappingCache = next;
  return mapping;
}
