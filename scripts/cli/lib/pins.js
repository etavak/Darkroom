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
