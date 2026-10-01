import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './env.js';
import { httpGetOk, sleep } from './http.js';
import { clientDist, ensureLogsDir, logsDir, root, serverEntry } from './paths.js';
import { clearPid, isPidAlive, runNpm, setPid, spawnDetached } from './process.js';

const SERVER_TIMEOUT_MS = 60_000;

/**
 * @param {string} logFile
 * @param {number} [maxChars]
 */
function readLogTail(logFile, maxChars = 1800) {
  try {
    if (!fs.existsSync(logFile)) return '';
    const text = fs.readFileSync(logFile, 'utf8');
    const slice = text.length > maxChars ? text.slice(-maxChars) : text;
    const ansi = new RegExp(String.raw`\u001b\[[0-9;]*m`, 'g');
    return slice
      .split(/\r?\n/)
      .map((l) => l.replace(ansi, ''))
      .filter((l) => l.trim())
      .slice(-24)
      .join('\n');
  } catch {
    return '';
  }
}

/**
 * Rebuild better-sqlite3 when the native addon does not load under the current Node.
 */
export async function ensureNativeModules() {
  const addon = path.join(root, 'node_modules', 'better-sqlite3');
  if (!fs.existsSync(addon)) return;
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(path.join(root, 'package.json'));
    require('better-sqlite3');
    return;
  } catch {
    // fall through to rebuild
  }
  await runNpm(['rebuild', 'better-sqlite3']);
}

/**
 * Build client/server dist if missing.
 */
export async function ensureBuilt() {
  if (!fs.existsSync(path.join(clientDist, 'index.html'))) {
    await runNpm(['run', 'build', '-w', 'client']);
  }
  if (!fs.existsSync(serverEntry)) {
    await runNpm(['run', 'build', '-w', 'server']);
  }
}

/**
 * @param {string} healthUrl
 * @param {number} pid
 * @param {string} logFile
 */
async function waitForServerReady(healthUrl, pid, logFile) {
  const start = Date.now();
  while (Date.now() - start < SERVER_TIMEOUT_MS) {
    if (await httpGetOk(healthUrl)) return;
    if (!isPidAlive(pid)) {
      const tail = readLogTail(logFile);
      clearPid('server');
      throw new Error(
        `Darkroom server exited before becoming ready (${healthUrl}).` +
          (tail ? `\n\nLast log lines (${logFile}):\n${tail}` : `\nSee ${logFile}`),
      );
    }
    await sleep(1000);
  }
  const tail = readLogTail(logFile);
  throw new Error(
    `Darkroom server did not become ready within ${Math.round(SERVER_TIMEOUT_MS / 1000)}s (${healthUrl}).` +
      (tail ? `\n\nLast log lines (${logFile}):\n${tail}` : `\nSee ${logFile}`),
  );
}

/**
 * @returns {Promise<{ started: boolean, alreadyRunning: boolean, appUrl: string }>}
 */
export async function ensureServerRunning() {
  const cfg = getConfig();
  const healthUrl = `${cfg.appUrl}/api/health`;
  if (await httpGetOk(healthUrl)) {
    return { started: false, alreadyRunning: true, appUrl: cfg.appUrl };
  }

  await ensureNativeModules();
  await ensureBuilt();
  ensureLogsDir();
  const logFile = path.join(logsDir, 'server.log');
  fs.writeFileSync(logFile, `\n--- ${new Date().toISOString()} ---\n`, { flag: 'a' });

  const pid = spawnDetached(process.execPath, [serverEntry], {
    cwd: path.join(root, 'server'),
    env: {
      ...process.env,
      PORT: String(cfg.port),
      COMFY_URL: cfg.comfyUrl,
    },
    logFile,
  });
  setPid('server', pid, true);
  await waitForServerReady(healthUrl, pid, logFile);
  return { started: true, alreadyRunning: false, appUrl: cfg.appUrl };
}
