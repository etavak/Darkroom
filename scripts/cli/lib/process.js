import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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
 * Resolve npm that belongs to the same Node as process.execPath.
 * PATH npm can be a different major (e.g. system Node 24 while Darkroom runs portable 22),
 * which rebuilds native addons against the wrong NODE_MODULE_VERSION.
 */
export function resolveNpmBin() {
  const dir = path.dirname(process.execPath);
  const candidates =
    process.platform === 'win32'
      ? [path.join(dir, 'npm.cmd'), path.join(dir, 'npm.exe')]
      : [path.join(dir, 'npm'), path.join(dir, 'npm-cli.js')];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, stdio?: 'ignore' | 'inherit' }} [opts]
 */
export function runNpm(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const npm = resolveNpmBin();
    const nodeDir = path.dirname(process.execPath);
    const baseEnv = opts.env ?? process.env;
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
    const prevPath = baseEnv.PATH || baseEnv.Path || process.env.PATH || '';
    const env = {
      ...baseEnv,
      [pathKey]: `${nodeDir}${path.delimiter}${prevPath}`,
      npm_config_scripts_prepend_node_path: 'true',
    };
    /** @type {string} */
    let command = npm;
    /** @type {string[]} */
    let npmArgs = args;
    // Portable Node on Unix sometimes ships npm as a script without +x via npm-cli.js only.
    if (npm.endsWith('npm-cli.js')) {
      command = process.execPath;
      npmArgs = [npm, ...args];
    }
    const child = spawn(command, npmArgs, {
      cwd: opts.cwd ?? root,
      env,
      stdio: opts.stdio ?? 'ignore',
      windowsHide: true,
      shell: process.platform === 'win32' && command.endsWith('.cmd'),
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
