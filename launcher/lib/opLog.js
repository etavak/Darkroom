import fs from 'node:fs';
import path from 'node:path';
import { ensureLogsDir, opsLogDir } from './paths.js';

/**
 * @param {string} componentId
 * @param {string} action
 */
export function createOpLog(componentId, action) {
  ensureLogsDir();
  fs.mkdirSync(opsLogDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(opsLogDir, `${stamp}-${componentId}-${action}.log`);
  const stream = fs.createWriteStream(file, { flags: 'a' });
  const write = (line) => {
    const text = typeof line === 'string' ? line : String(line);
    stream.write(`[${new Date().toISOString()}] ${text}\n`);
  };
  write(`=== ${componentId} ${action} ===`);
  return {
    file,
    info: (msg) => write(`INFO  ${msg}`),
    warn: (msg) => write(`WARN  ${msg}`),
    error: (msg) => write(`ERROR ${msg}`),
    close: () =>
      new Promise((resolve) => {
        stream.end(() => resolve(file));
      }),
  };
}

/**
 * Run an async op with a dedicated log file.
 * @template T
 * @param {string} componentId
 * @param {string} action
 * @param {(log: ReturnType<typeof createOpLog>) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withOpLog(componentId, action, fn) {
  const log = createOpLog(componentId, action);
  try {
    const result = await fn(log);
    log.info('OK');
    await log.close();
    return result;
  } catch (err) {
    log.error(err instanceof Error ? err.stack || err.message : String(err));
    await log.close();
    throw err;
  }
}
