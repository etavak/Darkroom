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
 * npm's own script next to a Node binary — the same layout in the portable downloads, the
 * Windows installer and Homebrew. Running it with Node needs no shell (npm.cmd does, and
 * cmd.exe trips over spaces in the Darkroom folder's path).
 * @param {string} [execPath]
 */
export function resolveNpmCli(execPath = process.execPath) {
  const dir = path.dirname(execPath);
  const candidates = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // macOS / Linux
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/**
 * A copy of `env` with `dir` first on the search path. Windows spells the variable Path (any
 * case goes); writing a second "PATH" beside it leaves the child with two, and Windows then
 * uses whichever sorts first — often the one without `dir`.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} dir
 */
export function withPathFirst(env, dir) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  /** @type {NodeJS.ProcessEnv} */
  const out = {};
  for (const [k, v] of Object.entries(env)) if (k === key || k.toUpperCase() !== 'PATH') out[k] = v;
  out[key] = env[key] ? `${dir}${path.delimiter}${env[key]}` : dir;
  return out;
}

/** One cmd.exe argument, quoted when it has spaces or characters cmd treats specially. */
function cmdQuote(/** @type {string} */ s) {
  return s === '' || /[\s"&|<>^()]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * spawn() that can also run .cmd / .bat files on Windows. Node refuses those without a shell,
 * and its shell option doesn't quote the command or arguments, so a path with a space breaks.
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} opts
 */
export function spawnAny(command, args, opts) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    const line = [command, ...args].map(cmdQuote).join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, windowsVerbatimArguments: true });
  }
  return spawn(command, args, opts);
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, stdio?: 'ignore' | 'inherit' }} [opts]
 */
export function runNpm(args, opts = {}) {
  return new Promise((resolve, reject) => {
    // npm-cli.js run by this very Node: no shell, and never another Node's npm
    const cli = resolveNpmCli();
    const command = cli ? process.execPath : resolveNpmBin();
    const npmArgs = cli ? [cli, ...args] : args;
    const env = {
      ...withPathFirst(opts.env ?? process.env, path.dirname(process.execPath)),
      npm_config_scripts_prepend_node_path: 'true',
    };
    const child = spawnAny(command, npmArgs, {
      cwd: opts.cwd ?? root,
      env,
      stdio: opts.stdio ?? 'ignore',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(undefined);
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
    const child = spawnAny(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: opts.stdio ?? 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(undefined);
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

/**
 * Processes listening on a local TCP port, with their command lines — and on macOS / Linux
 * their working folders (they're often started as "python main.py" from inside the folder).
 * @param {string | number} port
 * @returns {{ pid: number, cmd: string, cwd: string }[]}
 */
export function listeningProcesses(port) {
  if (process.platform === 'win32') {
    // netstat: "  TCP    127.0.0.1:8188    0.0.0.0:0    LISTENING    1234"
    const net = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true }).stdout || '';
    const pids = new Set(
      net
        .split(/\r?\n/)
        .filter((l) => /LISTENING/i.test(l) && new RegExp(`:${port}\\s`).test(l))
        .map((l) => Number(l.trim().split(/\s+/).pop()))
        .filter(Boolean),
    );
    return [...pids].map((pid) => {
      const ps = spawnSync(
        'powershell',
        ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
        { encoding: 'utf8', windowsHide: true },
      );
      return { pid, cmd: (ps.stdout || '').trim(), cwd: '' };
    });
  }
  const lsof = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  return (lsof.stdout || '')
    .split('\n')
    .map((l) => Number(l.trim()))
    .filter(Boolean)
    .map((pid) => {
      const cmd = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '';
      const cwd = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout || '';
      return { pid, cmd: cmd.trim(), cwd: cwd.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? '' };
    });
}
