import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './env.js';
import { httpGetOk, sleep } from './http.js';
import { clientDist, ensureLogsDir, logsDir, root, serverEntry } from './paths.js';
import { clearPid, isPidAlive, killTree, listeningProcesses, readPids, runNpm, setPid, spawnDetached } from './process.js';

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
 * Does better-sqlite3's native module load under this Node? Checked in a separate process:
 * loading it here would keep the file locked on Windows for as long as the launcher runs, and
 * Update / Repair Darkroom (npm) couldn't replace it. (A bare require() hides an ABI mismatch;
 * the native file only loads when a Database is created.)
 */
function betterSqlite3Loads() {
  const probe = "const D=require('better-sqlite3'); const d=new D(':memory:'); d.close();";
  return spawnSync(process.execPath, ['-e', probe], { cwd: root, stdio: 'ignore', windowsHide: true }).status === 0;
}

/**
 * Rebuild better-sqlite3 when the native addon does not load under the current Node.
 */
export async function ensureNativeModules() {
  if (!fs.existsSync(path.join(root, 'node_modules', 'better-sqlite3'))) return;
  if (betterSqlite3Loads()) return;
  // Use inherit so rebuild failures are visible in the CLI.
  await runNpm(['rebuild', 'better-sqlite3'], { stdio: 'inherit' });
  if (!betterSqlite3Loads()) throw new Error('better-sqlite3 still does not load after rebuilding it — run Components → Darkroom → Repair.');
}

/**
 * The Darkroom server answering on this install's port, if it runs this folder's server —
 * also one this launcher has no record of starting (e.g. from an earlier window).
 * @param {ReturnType<typeof getConfig>} [cfg]
 */
export function findLocalServer(cfg = getConfig()) {
  const want = serverEntry.toLowerCase().replace(/\\/g, '/');
  const proc = listeningProcesses(cfg.port).find((p) => {
    const cmd = p.cmd.toLowerCase().replace(/\\/g, '/');
    return cmd.includes(want) || (cmd.includes('dist/index.js') && p.cwd && path.resolve(p.cwd).toLowerCase().startsWith(root.toLowerCase()));
  });
  return proc ? { pid: proc.pid } : null;
}

/**
 * Stop this folder's Darkroom server (started by this launcher or not) before its files are
 * replaced — Windows can't replace a native module a running server has loaded.
 * @returns {Promise<boolean>} whether one was running
 */
export async function stopDarkroomServer() {
  const cfg = getConfig();
  const rec = readPids().server;
  const pid = rec?.pid && isPidAlive(rec.pid) ? rec.pid : findLocalServer(cfg)?.pid;
  if (!pid) return false;
  killTree(pid);
  clearPid('server');
  for (let i = 0; i < 20 && isPidAlive(pid); i++) await sleep(250);
  return true;
}

/**
 * True if any source file under dir is newer than marker (mtime).
 * @param {string} dir
 * @param {number} markerMtimeMs
 * @param {(name: string) => boolean} [filter]
 */
function sourceNewerThan(dir, markerMtimeMs, filter) {
  if (!fs.existsSync(dir)) return false;
  /** @type {string[]} */
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) break;
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
        stack.push(full);
      } else if (!filter || filter(e.name)) {
        try {
          if (fs.statSync(full).mtimeMs > markerMtimeMs) return true;
        } catch {
          // ignore
        }
      }
    }
  }
  return false;
}

/**
 * Which builds are missing or older than their sources (an update waiting to be applied).
 * @returns {{ client: boolean, server: boolean }}
 */
export function buildStale() {
  const clientMarker = path.join(clientDist, 'index.html');
  const clientSrc = path.join(root, 'client', 'src');
  const clientNeeds =
    !fs.existsSync(clientMarker) ||
    sourceNewerThan(clientSrc, fs.statSync(clientMarker).mtimeMs, (n) =>
      /\.(tsx?|jsx?|css|html)$/.test(n),
    ) ||
    sourceNewerThan(path.join(root, 'client', 'public'), fs.statSync(clientMarker).mtimeMs);

  const serverNeeds =
    !fs.existsSync(serverEntry) ||
    sourceNewerThan(path.join(root, 'server', 'src'), fs.statSync(serverEntry).mtimeMs, (n) =>
      /\.tsx?$/.test(n),
    ) ||
    sourceNewerThan(path.join(root, 'server', 'presets'), fs.existsSync(serverEntry) ? fs.statSync(serverEntry).mtimeMs : 0, (n) =>
      /\.json$/.test(n),
    );

  return { client: clientNeeds, server: serverNeeds };
}

/**
 * Build client/server dist if missing or source is newer than dist.
 */
export async function ensureBuilt() {
  const stale = buildStale();
  if (stale.client) await runNpm(['run', 'build', '-w', 'client']);
  if (stale.server) await runNpm(['run', 'build', '-w', 'server']);
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

/**
 * Rebuild and restart only the Darkroom server (ComfyUI keeps running). Only a server this
 * launcher started can be restarted.
 * @returns {Promise<{ restarted: boolean, reason?: string }>}
 */
export async function restartServer() {
  const cfg = getConfig();
  const pids = readPids();
  const running = await httpGetOk(`${cfg.appUrl}/api/health`);
  if (running) {
    const own = pids.server?.owned && pids.server.pid && isPidAlive(pids.server.pid);
    if (!own) {
      return { restarted: false, reason: 'The running server wasn’t started by this launcher — stop it yourself, then Start Darkroom.' };
    }
    killTree(pids.server.pid);
    clearPid('server');
    // Wait for the port to free up
    const until = Date.now() + 10_000;
    while (Date.now() < until && (await httpGetOk(`${cfg.appUrl}/api/health`, 800))) await sleep(300);
  }
  await ensureServerRunning();
  return { restarted: true };
}
