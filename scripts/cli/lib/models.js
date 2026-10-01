import fs from 'node:fs';
import path from 'node:path';
import {
  checkpointsPath,
  familiesDir,
  MODEL_SUBDIRS,
  modelDirForType,
} from './paths.js';

export function listFamilies() {
  if (!fs.existsSync(familiesDir)) return [];
  return fs
    .readdirSync(familiesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(familiesDir, f), 'utf8'));
        return { id: raw.id || f.replace(/\.json$/, ''), name: raw.name || raw.id };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function readCheckpointMappings() {
  try {
    if (!fs.existsSync(checkpointsPath)) return { mappings: {} };
    return JSON.parse(fs.readFileSync(checkpointsPath, 'utf8'));
  } catch {
    return { mappings: {} };
  }
}

/**
 * @param {string} filename
 * @param {string} family
 */
export function saveCheckpointFamily(filename, family) {
  const data = readCheckpointMappings();
  data.mappings = data.mappings || {};
  const prev = data.mappings[filename] || {};
  data.mappings[filename] = { ...prev, family };
  fs.mkdirSync(path.dirname(checkpointsPath), { recursive: true });
  fs.writeFileSync(checkpointsPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Strip quotes / file:// from dragged paths.
 * @param {string} raw
 */
export function normalizeDraggedPath(raw) {
  let p = raw.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1);
  }
  if (p.startsWith('file://')) {
    try {
      p = decodeURIComponent(new URL(p).pathname);
      if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(p)) {
        p = p.slice(1);
      }
    } catch {
      p = p.replace(/^file:\/\//, '');
    }
  }
  return p;
}

/**
 * @param {string} src
 * @param {string} type
 * @param {'copy' | 'move'} mode
 * @returns {{ dest: string, filename: string }}
 */
export function installModelFile(src, type, mode) {
  const dir = modelDirForType(type);
  if (!dir) throw new Error('COMFY_DIR is not set or models folder is missing');
  fs.mkdirSync(dir, { recursive: true });
  const filename = path.basename(src);
  const dest = path.join(dir, filename);
  if (path.resolve(src) === path.resolve(dest)) {
    return { dest, filename };
  }
  if (fs.existsSync(dest)) {
    throw new Error(`Destination already exists: ${dest}`);
  }
  if (mode === 'move') fs.renameSync(src, dest);
  else fs.copyFileSync(src, dest);
  return { dest, filename };
}

/**
 * @param {string} [type]
 * @returns {Array<{ type: string, name: string, path: string, size: number, family?: string }>}
 */
export function listModels(type) {
  /** @type {Array<{ type: string, name: string, path: string, size: number, family?: string }>} */
  const out = [];
  const mappings = readCheckpointMappings().mappings || {};
  const types = type ? [type] : Object.keys(MODEL_SUBDIRS);
  for (const t of types) {
    const dir = modelDirForType(t);
    if (!dir || !fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (!/\.(safetensors|ckpt|pt|pth|bin)$/i.test(name)) continue;
      out.push({
        type: t,
        name,
        path: full,
        size: st.size,
        family: t === 'checkpoint' ? mappings[name]?.family : undefined,
      });
    }
  }
  return out.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

export function formatBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

export function renameModel(filePath, newName) {
  const dir = path.dirname(filePath);
  const dest = path.join(dir, newName);
  if (fs.existsSync(dest)) throw new Error(`Already exists: ${newName}`);
  fs.renameSync(filePath, dest);
  const mappings = readCheckpointMappings();
  const oldBase = path.basename(filePath);
  if (mappings.mappings?.[oldBase]) {
    mappings.mappings[newName] = mappings.mappings[oldBase];
    delete mappings.mappings[oldBase];
    fs.writeFileSync(checkpointsPath, JSON.stringify(mappings, null, 2) + '\n', 'utf8');
  }
  return dest;
}

export function deleteModel(filePath) {
  fs.unlinkSync(filePath);
  const mappings = readCheckpointMappings();
  const base = path.basename(filePath);
  if (mappings.mappings?.[base]) {
    delete mappings.mappings[base];
    fs.writeFileSync(checkpointsPath, JSON.stringify(mappings, null, 2) + '\n', 'utf8');
  }
}

export function isPickleExtension(filePath) {
  return /\.(ckpt|pt|pth)$/i.test(filePath);
}
