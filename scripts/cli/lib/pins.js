import fs from 'node:fs';
import { componentsJsonPath } from './paths.js';

/** @type {Record<string, any> | null} */
let cached = null;

/** @returns {Record<string, any>} */
export function loadPins() {
  if (cached) return cached;
  const raw = fs.readFileSync(componentsJsonPath, 'utf8');
  cached = JSON.parse(raw);
  return /** @type {Record<string, any>} */ (cached);
}

export function reloadPins() {
  cached = null;
  return loadPins();
}

/**
 * @param {string} key dotted path e.g. "node.tested"
 */
export function getPin(key) {
  const pins = loadPins();
  const parts = key.split('.');
  let cur = pins;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}
