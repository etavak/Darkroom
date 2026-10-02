import fs from 'node:fs';
import path from 'node:path';
import { getModelsRoot } from './paths.js';

/**
 * @param {string} src
 * @param {string} destDir
 */
export function isOutsideComfyModels(src, destDir = '') {
  const modelsRoot = getModelsRoot(process.env.COMFY_DIR || '');
  const root = destDir || modelsRoot;
  if (!root) return true;
  const resolvedSrc = path.resolve(src);
  const resolvedRoot = path.resolve(root);
  return (
    resolvedSrc !== resolvedRoot &&
    !resolvedSrc.startsWith(resolvedRoot + path.sep)
  );
}

/**
 * Default install mode for a local file.
 * @param {string} src
 * @returns {'link' | 'copy' | 'move'}
 */
export function defaultInstallMode(src) {
  return isOutsideComfyModels(src) ? 'link' : 'copy';
}

/**
 * @param {string} a
 * @param {string} b
 */
function sameFilesystem(a, b) {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(path.dirname(b));
    if (typeof sa.dev === 'number' && typeof sb.dev === 'number' && sa.dev !== sb.dev) {
      return false;
    }
  } catch {
    // fall through to drive-letter check on Windows
  }
  if (process.platform === 'win32') {
    const da = path.resolve(a).slice(0, 2).toUpperCase();
    const db = path.resolve(b).slice(0, 2).toUpperCase();
    return /^[A-Z]:$/.test(da) && da === db;
  }
  return true;
}

/**
 * Create a link at dest pointing at src.
 * @param {string} src
 * @param {string} dest
 * @returns {{ linkType: 'symlink' | 'hardlink' }}
 */
export function createModelLink(src, dest) {
  const resolvedSrc = path.resolve(src);
  if (!fs.existsSync(resolvedSrc)) {
    throw new Error(`Source file not found: ${resolvedSrc}`);
  }
  if (fs.existsSync(dest) || fs.lstatSync(dest, { throwIfNoEntry: false })) {
    throw new Error(`Destination already exists: ${dest}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  try {
    // Absolute symlink so "linked from" stays valid if Darkroom cwd changes
    fs.symlinkSync(resolvedSrc, dest);
    return { linkType: 'symlink' };
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
    const winPerm =
      process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN');

    if (!winPerm) throw err;

    if (sameFilesystem(resolvedSrc, dest)) {
      try {
        fs.linkSync(resolvedSrc, dest);
        return { linkType: 'hardlink' };
      } catch (hardErr) {
        const msg = hardErr instanceof Error ? hardErr.message : String(hardErr);
        throw new Error(
          `Could not create a symlink (Windows needs Developer Mode for symlinks without admin) ` +
            `and hard link failed (${msg}). Choose Copy instead, or enable Developer Mode: ` +
            `Settings → System → For developers → Developer Mode.`,
        );
      }
    }

    throw new Error(
      `Could not create a symlink (Windows needs Developer Mode for symlinks without admin) ` +
        `and a hard link is not possible across drives. Choose Copy instead, or enable Developer Mode: ` +
        `Settings → System → For developers → Developer Mode.`,
    );
  }
}

/**
 * Inspect a path: symlink / hardlink / file / missing / broken.
 * @param {string} destPath
 * @param {string} [recordedSource]
 * @returns {{
 *   kind: 'symlink' | 'hardlink' | 'file' | 'missing' | 'broken',
 *   sourcePath: string | null,
 *   broken: boolean,
 * }}
 */
export function inspectModelPath(destPath, recordedSource) {
  let lst;
  try {
    lst = fs.lstatSync(destPath);
  } catch {
    return { kind: 'missing', sourcePath: recordedSource || null, broken: true };
  }

  if (lst.isSymbolicLink()) {
    let target = null;
    try {
      target = fs.readlinkSync(destPath);
      if (!path.isAbsolute(target)) {
        target = path.resolve(path.dirname(destPath), target);
      }
    } catch {
      return { kind: 'broken', sourcePath: recordedSource || null, broken: true };
    }
    const exists = fs.existsSync(target);
    return { kind: 'symlink', sourcePath: target, broken: !exists };
  }

  if (recordedSource && fs.existsSync(recordedSource)) {
    try {
      const srcStat = fs.statSync(recordedSource);
      if (srcStat.ino && lst.ino && srcStat.ino === lst.ino && srcStat.dev === lst.dev) {
        return { kind: 'hardlink', sourcePath: path.resolve(recordedSource), broken: false };
      }
    } catch {
      // ignore
    }
  }

  if (recordedSource && !fs.existsSync(recordedSource)) {
    // Recorded hardlink/symlink source gone — dest file may still exist as orphaned copy/hardlink
    return {
      kind: lst.nlink > 1 ? 'hardlink' : 'file',
      sourcePath: path.resolve(recordedSource),
      broken: true,
    };
  }

  return { kind: 'file', sourcePath: null, broken: false };
}
