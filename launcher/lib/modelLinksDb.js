import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The linked-model records (server/data/darkroom.db). Every call runs in a short-lived Node
 * process: loading better-sqlite3's native file here would keep it locked on Windows for as
 * long as the launcher runs, and Update / Repair Darkroom (npm) couldn't replace it.
 */
const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'modelLinksWorker.js');

/**
 * @param {string} op a function exported by modelLinksStore.js
 * @param {unknown[]} args
 * @returns {any}
 */
function call(op, args) {
  const r = spawnSync(process.execPath, [worker, op, JSON.stringify(args)], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || '').trim() || `model links: ${op} failed`);
  return JSON.parse(r.stdout || 'null');
}


/** @param {{ filename: string, modelType: string, destPath: string, sourcePath: string, linkType: 'symlink' | 'hardlink' }} row */
export const upsertModelLink = (row) => call('upsertModelLink', [row]);

/** @param {string} destPath */
export const getModelLinkByDest = (destPath) => call('getModelLinkByDest', [destPath]);

/** @param {string} filename */
export const getModelLinkByFilename = (filename) => call('getModelLinkByFilename', [filename]);

/** @returns {Array<Record<string, unknown>>} */
export const listModelLinks = () => call('listModelLinks', []);

/** @param {string} destPath */
export const removeModelLinkByDest = (destPath) => call('removeModelLinkByDest', [destPath]);

/** @param {string} oldDest @param {string} newDest @param {string} newFilename */
export const renameModelLink = (oldDest, newDest, newFilename) => call('renameModelLink', [oldDest, newDest, newFilename]);

/** @param {string} destPath @param {string} sourcePath @param {'symlink' | 'hardlink'} linkType */
export const updateModelLinkSource = (destPath, sourcePath, linkType) => call('updateModelLinkSource', [destPath, sourcePath, linkType]);

export const getModelLinksDbPath = () => call('getModelLinksDbPath', []);

/** @param {string} from @param {string} to @returns {number} */
export const rebaseModelLinks = (from, to) => call('rebaseModelLinks', [from, to]);
