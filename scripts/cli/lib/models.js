import fs from 'node:fs';
import path from 'node:path';
import {
  checkpointsPath,
  familiesDir,
  MODEL_SUBDIRS,
  modelDirForType,
} from './paths.js';
import { createModelLink, inspectModelPath } from './linkInstall.js';
import {
  getModelLinkByDest,
  listModelLinks,
  removeModelLinkByDest,
  renameModelLink,
  upsertModelLink,
} from './modelLinksDb.js';

export function listFamilies() {
  if (!fs.existsSync(familiesDir)) return [];
  return fs
    .readdirSync(familiesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(familiesDir, f), 'utf8'));
        return {
          id: raw.id || f.replace(/\.json$/, ''),
          name: raw.name || raw.id,
          supportsGguf: Boolean(raw.supportsGguf),
          loaderKind: raw.loaderKind || 'checkpoint',
          requiredComponents: raw.requiredComponents || {},
          filenameHints: raw.filenameHints || {},
          dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
        };
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
 * @param {'copy' | 'move' | 'link'} mode
 * @returns {{ dest: string, filename: string, linkType?: 'symlink' | 'hardlink' }}
 */
export function installModelFile(src, type, mode) {
  const filename = path.basename(src);
  const dir = modelDirForType(type, process.env.COMFY_DIR || '', { filename });
  if (!dir) throw new Error('COMFY_DIR is not set or models folder is missing');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, filename);
  if (path.resolve(src) === path.resolve(dest)) {
    return { dest, filename };
  }
  if (fs.existsSync(dest) || fs.lstatSync(dest, { throwIfNoEntry: false })) {
    throw new Error(`Destination already exists: ${dest}`);
  }

  if (mode === 'link') {
    const { linkType } = createModelLink(src, dest);
    upsertModelLink({
      filename,
      modelType: type,
      destPath: dest,
      sourcePath: path.resolve(src),
      linkType,
    });
    return { dest, filename, linkType };
  }

  if (mode === 'move') fs.renameSync(src, dest);
  else fs.copyFileSync(src, dest);
  return { dest, filename };
}

/**
 * @param {string} [type]
 * @returns {Array<{
 *   type: string,
 *   name: string,
 *   path: string,
 *   size: number,
 *   family?: string,
 *   linkType?: 'symlink' | 'hardlink' | null,
 *   sourcePath?: string | null,
 *   broken?: boolean,
 * }>}
 */
export function listModels(type) {
  /** @type {Array<{
   *   type: string,
   *   name: string,
   *   path: string,
   *   size: number,
   *   family?: string,
   *   linkType?: 'symlink' | 'hardlink' | null,
   *   sourcePath?: string | null,
   *   broken?: boolean,
   * }>} */
  const out = [];
  const mappings = readCheckpointMappings().mappings || {};
  /** @type {Map<string, Record<string, unknown>>} */
  const linkByDest = new Map();
  try {
    for (const row of listModelLinks()) {
      linkByDest.set(String(row.dest_path), row);
    }
  } catch {
    // DB unavailable — still list files
  }

  const types = type ? [type] : Object.keys(MODEL_SUBDIRS);
  for (const t of types) {
    const dir = modelDirForType(t);
    if (!dir || !fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let lst;
      try {
        lst = fs.lstatSync(full);
      } catch {
        continue;
      }
      // Include regular files and symlinks (even broken)
      if (!lst.isFile() && !lst.isSymbolicLink()) continue;
      if (!/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(name)) continue;

      const recorded = linkByDest.get(path.resolve(full));
      const inspected = inspectModelPath(
        full,
        recorded ? String(recorded.source_path) : undefined,
      );

      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        size = 0;
      }

      out.push({
        type: t,
        name,
        path: full,
        size,
        family:
          t === 'checkpoint' || t === 'diffusion' ? mappings[name]?.family : undefined,
        linkType:
          inspected.kind === 'symlink' || inspected.kind === 'hardlink'
            ? inspected.kind
            : recorded
              ? /** @type {'symlink'|'hardlink'} */ (recorded.link_type)
              : null,
        sourcePath: inspected.sourcePath || (recorded ? String(recorded.source_path) : null),
        broken: inspected.broken,
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
  if (fs.existsSync(dest) || fs.lstatSync(dest, { throwIfNoEntry: false })) {
    throw new Error(`Already exists: ${newName}`);
  }
  fs.renameSync(filePath, dest);
  const mappings = readCheckpointMappings();
  const oldBase = path.basename(filePath);
  if (mappings.mappings?.[oldBase]) {
    mappings.mappings[newName] = mappings.mappings[oldBase];
    delete mappings.mappings[oldBase];
    fs.writeFileSync(checkpointsPath, JSON.stringify(mappings, null, 2) + '\n', 'utf8');
  }
  try {
    renameModelLink(filePath, dest, newName);
  } catch {
    // ignore
  }
  return dest;
}

/**
 * Remove a model from the ComfyUI folder.
 * For linked installs, only the link/name in models/ is removed — never the original file.
 * @param {string} filePath
 */
export function deleteModel(filePath) {
  const recorded = getModelLinkByDest(filePath);
  let isLink = Boolean(recorded);
  try {
    const lst = fs.lstatSync(filePath);
    if (lst.isSymbolicLink()) isLink = true;
  } catch {
    // missing
  }

  // unlink removes symlink or one hardlink name; never follows to delete the original uniquely
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (!recorded) throw err;
  }

  if (recorded || isLink) {
    try {
      removeModelLinkByDest(filePath);
    } catch {
      // ignore
    }
  }

  const mappings = readCheckpointMappings();
  const base = path.basename(filePath);
  if (mappings.mappings?.[base]) {
    delete mappings.mappings[base];
    fs.writeFileSync(checkpointsPath, JSON.stringify(mappings, null, 2) + '\n', 'utf8');
  }

  return { removedLinkOnly: Boolean(recorded || isLink) };
}

export function isPickleExtension(filePath) {
  return /\.(ckpt|pt|pth)$/i.test(filePath);
}

/**
 * Broken linked models (for Doctor).
 * @returns {Array<{ destPath: string, sourcePath: string | null, filename: string, modelType: string, linkType: string }>}
 */
export function listBrokenModelLinks() {
  /** @type {Array<{ destPath: string, sourcePath: string | null, filename: string, modelType: string, linkType: string }>} */
  const broken = [];
  let rows = [];
  try {
    rows = listModelLinks();
  } catch {
    return broken;
  }
  for (const row of rows) {
    const dest = String(row.dest_path);
    const source = String(row.source_path);
    const info = inspectModelPath(dest, source);
    if (info.broken || info.kind === 'missing') {
      broken.push({
        destPath: dest,
        sourcePath: info.sourcePath || source,
        filename: String(row.filename),
        modelType: String(row.model_type),
        linkType: String(row.link_type),
      });
    }
  }
  return broken;
}
