import { pathToFileURL } from 'node:url';
import * as store from './modelLinksStore.js';

/**
 * `node modelLinksWorker.js <function> <json args>` — runs one model-link store function and
 * prints its result as JSON. modelLinksDb.js calls this so the launcher itself never loads the
 * database's native module (Windows would lock it against Update / Repair).
 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [op, rawArgs] = process.argv.slice(2);
  const fn = /** @type {Record<string, (...a: unknown[]) => unknown>} */ (/** @type {unknown} */ (store))[op];
  if (typeof fn !== 'function') {
    process.stderr.write(`unknown model-link operation: ${op}\n`);
    process.exit(2);
  }
  try {
    const result = fn(...JSON.parse(rawArgs || '[]'));
    process.stdout.write(JSON.stringify(result ?? null));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
