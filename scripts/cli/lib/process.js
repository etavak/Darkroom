import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ensureLogsDir, logsDir, pidPath, root } from './paths.js';

/**
 * @typedef {{ pid: number, owned: boolean, startedAt?: string }} PidEntry
 * @typedef {{ comfy?: PidEntry, server?: PidEntry }} PidFile
 */

/** @returns {PidFile} */
export function readPids() {
  try {
    if (!fs.existsSync(pidPath)) return {};
    return JSON.parse(fs.readFileSync(pidPath, 'utf8'));
  } catch {
    return {};
  }
}

/** @param {PidFile} data */
export function writePids(data) {
  ensureLogsDir();
  fs.writeFileSync(pidPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * @param {'comfy' | 'server'} key
 * @param {number | null | undefined} pid
 * @param {boolean} owned
 */
export function setPid(key, pid, owned) {
  const data = readPids();
  if (!pid) {
    delete data[key];
  } else {
    data[key] = { pid, owned, startedAt: new Date().toISOString() };
  }
  writePids(data);
}

export function clearPid(key) {
  setPid(key, null, false);
}

export function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killTree(pid) {
  if (!pid || pid <= 0) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  for (const sig of /** @type {const} */ (['SIGTERM', 'SIGKILL'])) {
    try {
      process.kill(-pid, sig);
    } catch {
      // ignore
    }
    try {
      process.kill(pid, sig);
    } catch {
      // ignore
    }
  }
}

/**
 * Spawn a long-lived detached process; returns pid.
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, logFile: string }} opts
 */
export function spawnDetached(command, args, opts) {
  ensureLogsDir();
  fs.mkdirSync(logsDir, { recursive: true });
  const out = fs.openSync(opts.logFile, 'a');
  const child = spawn(command, args, {
    cwd: opts.cwd ?? root,
    env: opts.env ?? process.env,
    stdio: ['ignore', out, out],
    windowsHide: true,
    detached: true,
  });
  fs.closeSync(out);
  child.unref();
  return child.pid ?? 0;
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, stdio?: 'ignore' | 'inherit' }} [opts]
 */
export function runNpm(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npm, args, {
      cwd: opts.cwd ?? root,
      env: opts.env ?? process.env,
      stdio: opts.stdio ?? 'ignore',
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(' ')} failed (exit ${code})`));
    });
  });
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, stdio?: 'ignore' | 'inherit' }} [opts]
 */
export function runCommand(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: opts.stdio ?? 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32' && command.endsWith('.cmd'),
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (exit ${code})`));
    });
  });
}

export function openBrowser(url) {
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    // ignore
  }
}
