import fs from 'node:fs';
import path from 'node:path';
import { getConfig, loadEnvFile } from './env.js';
import { httpGetOk, sleep } from './http.js';
import {
  ensureLogsDir,
  getComfyPortableRoot,
  getComfyPython,
  getComfyUiRoot,
  logsDir,
  root,
} from './paths.js';
import { clearPid, isPidAlive, killTree, listeningProcesses, readPids, setPid, spawnDetached } from './process.js';

const COMFY_TIMEOUT_MS = 120_000;

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
 * Wait until ComfyUI answers, or fail early if the process dies.
 * @param {string} statsUrl
 * @param {number} pid
 * @param {string} logFile
 */
async function waitForComfyReady(statsUrl, pid, logFile) {
  const start = Date.now();
  while (Date.now() - start < COMFY_TIMEOUT_MS) {
    if (await httpGetOk(statsUrl)) return;
    if (!isPidAlive(pid)) {
      const tail = readLogTail(logFile);
      clearPid('comfy');
      throw new Error(
        `ComfyUI exited before becoming ready (${statsUrl}).` +
          (tail ? `\n\nLast log lines (${logFile}):\n${tail}` : `\nSee ${logFile}`),
      );
    }
    await sleep(1000);
  }
  const tail = readLogTail(logFile);
  throw new Error(
    `ComfyUI did not become ready within ${Math.round(COMFY_TIMEOUT_MS / 1000)}s (${statsUrl}).` +
      (tail ? `\n\nLast log lines (${logFile}):\n${tail}` : `\nSee ${logFile}`),
  );
}

/** Settings → VRAM mode, mirrored into .env as COMFY_VRAM_MODE. */
const VRAM_FLAGS = { low: '--lowvram', normal: '--normalvram', high: '--highvram' };

/**
 * Launch flags chosen in Darkroom settings. Read from .env on every launch so a
 * change made in the web UI applies without restarting the CLI.
 */
export function comfyLaunchFlags() {
  const fileEnv = loadEnvFile();
  const vram = (fileEnv.COMFY_VRAM_MODE || process.env.COMFY_VRAM_MODE || 'auto').toLowerCase();
  // Default auto; COMFY_PREVIEW_METHOD is set by the UI when per-prompt override is unavailable.
  const previewMethod = fileEnv.COMFY_PREVIEW_METHOD || process.env.COMFY_PREVIEW_METHOD || 'auto';
  const flags = ['--preview-method', previewMethod];
  const vramFlag = VRAM_FLAGS[/** @type {keyof typeof VRAM_FLAGS} */ (vram)];
  if (vramFlag) flags.push(vramFlag);
  // Set when ComfyUI was installed on a PC without a GPU it can use (see installComfy.js)
  if ((fileEnv.COMFY_FORCE_CPU || process.env.COMFY_FORCE_CPU || '').toLowerCase() === 'true') flags.push('--cpu');
  return flags;
}

/**
 * Copy Darkroom's own ComfyUI fixes (comfy_nodes/*) into custom_nodes so they load with
 * ComfyUI — refreshed on every start, so updates to Darkroom carry the latest fixes.
 * Never blocks starting ComfyUI.
 * @param {string} uiRoot
 */
export function installDarkroomNodes(uiRoot) {
  const src = path.join(root, 'comfy_nodes');
  if (!fs.existsSync(src)) return;
  for (const name of fs.readdirSync(src)) {
    try {
      const from = path.join(src, name);
      if (!fs.statSync(from).isDirectory()) continue;
      const dest = path.join(uiRoot, 'custom_nodes', name);
      fs.mkdirSync(dest, { recursive: true });
      for (const file of fs.readdirSync(from)) {
        const a = path.join(from, file);
        const b = path.join(dest, file);
        if (!fs.statSync(a).isFile()) continue;
        const next = fs.readFileSync(a);
        if (!fs.existsSync(b) || !fs.readFileSync(b).equals(next)) fs.writeFileSync(b, next);
      }
    } catch {
      // a fix that can't be copied mustn't stop ComfyUI from starting
    }
  }
}

/**
 * Spawn a local ComfyUI (detached, logged, recorded as Darkroom-owned) without waiting.
 * Shared by the CLI launcher and the web UI's "Start ComfyUI" button.
 * @param {ReturnType<typeof getConfig>} [cfg]
 * @returns {{ pid: number, logFile: string }}
 */
export function startComfyProcess(cfg = getConfig()) {
  if (!cfg.comfyDir || !fs.existsSync(cfg.comfyDir)) {
    throw new Error('COMFY_DIR is not set or missing. Run the Darkroom setup wizard first.');
  }
  const portable = getComfyPortableRoot(cfg.comfyDir);
  const uiRoot = getComfyUiRoot(cfg.comfyDir);
  if (!portable || !uiRoot) throw new Error('Invalid COMFY_DIR');
  const mainPy = path.join(uiRoot, 'main.py');
  if (!fs.existsSync(mainPy)) throw new Error(`ComfyUI main.py not found: ${mainPy}`);
  installDarkroomNodes(uiRoot);

  ensureLogsDir();
  const logFile = path.join(logsDir, 'comfyui.log');
  fs.writeFileSync(logFile, `\n--- ${new Date().toISOString()} ---\n`, { flag: 'a' });

  const port = new URL(cfg.comfyUrl).port || '8188';
  const serveArgs = ['--listen', '127.0.0.1', '--port', String(port), ...comfyLaunchFlags()];

  let pid = 0;
  const embedded = path.join(portable, 'python_embeded', 'python.exe');
  if (process.platform === 'win32' && fs.existsSync(embedded)) {
    // The portable build. --windows-standalone-build also opens ComfyUI's own page in the
    // browser; Darkroom is the UI
    pid = spawnDetached(embedded, ['-s', mainPy, '--windows-standalone-build', '--disable-auto-launch', ...serveArgs], {
      cwd: portable,
      logFile,
    });
  } else {
    // A ComfyUI with its own Python environment (venv) — macOS, Linux, or one set up by hand on
    // Windows. main.py by its full path, so findLocalComfy can recognise the process later.
    const python = getComfyPython(cfg.comfyDir);
    if (path.isAbsolute(python) && !fs.existsSync(python)) throw new Error(`ComfyUI's Python not found: ${python}`);
    pid = spawnDetached(python, [mainPy, ...serveArgs], {
      cwd: uiRoot,
      logFile,
      env: {
        ...process.env,
        ...(process.platform === 'darwin' ? { PYTORCH_ENABLE_MPS_FALLBACK: '1' } : {}),
      },
    });
  }
  setPid('comfy', pid, true);
  return { pid, logFile };
}

/**
 * @returns {Promise<{ started: boolean, alreadyRunning: boolean }>}
 */
export async function ensureComfyRunning() {
  const cfg = getConfig();
  const statsUrl = `${cfg.comfyUrl}/system_stats`;

  if (cfg.remote) {
    if (await httpGetOk(statsUrl)) {
      return { started: false, alreadyRunning: true };
    }
    throw new Error(
      `Remote ComfyUI is not reachable at ${statsUrl}. Start it with --listen and check COMFY_URL.`,
    );
  }

  if (await httpGetOk(statsUrl)) {
    adoptRunningComfy(cfg);
    return { started: false, alreadyRunning: true };
  }

  if (!cfg.comfyDir) {
    throw new Error(
      `ComfyUI is not reachable at ${statsUrl}. Use Components → ComfyUI or Install everything.`,
    );
  }
  if (!fs.existsSync(cfg.comfyDir)) {
    throw new Error(
      `COMFY_DIR does not exist: ${cfg.comfyDir}. Use Components or Doctor to repair.`,
    );
  }

  const { pid, logFile } = startComfyProcess(cfg);
  await waitForComfyReady(statsUrl, pid, logFile);
  return { started: true, alreadyRunning: false };
}

/**
 * The process serving ComfyUI on this machine's port, when it runs this install's
 * ComfyUI (main.py under COMFY_DIR — also a copy of this folder that was since replaced,
 * as long as it ran from the same path). Works without a pid record.
 * @param {ReturnType<typeof getConfig>} [cfg]
 * @returns {{ pid: number } | null}
 */
export function findLocalComfy(cfg = getConfig()) {
  if (cfg.remote || !cfg.comfyDir) return null;
  let port;
  try {
    const u = new URL(cfg.comfyUrl);
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)) return null;
    port = u.port || (u.protocol === 'https:' ? '443' : '80');
  } catch {
    return null;
  }
  const dir = path.resolve(cfg.comfyDir).toLowerCase();
  const ours = (/** @type {string} */ cmd) => {
    const c = cmd.toLowerCase().replace(/\\/g, '/');
    return c.includes('main.py') && c.includes(dir.replace(/\\/g, '/'));
  };

  for (const proc of listeningProcesses(port)) {
    // The portable build runs main.py by its full path (which includes COMFY_DIR); older
    // macOS / Linux starts ran "python main.py" from inside ComfyUI, so check the folder too
    if (ours(proc.cmd)) return { pid: proc.pid };
    if (proc.cmd.includes('main.py') && proc.cwd && path.resolve(proc.cwd).toLowerCase().startsWith(dir)) return { pid: proc.pid };
  }
  return null;
}

/**
 * ComfyUI was already running: if it's this install's and no launcher has it on record
 * (e.g. it was started from a copy of this folder that was since replaced), record it so
 * Stop everything can stop it.
 * @param {ReturnType<typeof getConfig>} cfg
 */
export function adoptRunningComfy(cfg) {
  const rec = readPids().comfy;
  if (rec?.pid && isPidAlive(rec.pid)) return;
  const found = findLocalComfy(cfg);
  if (found) setPid('comfy', found.pid, true);
}

/**
 * Stop this install's ComfyUI before its files are replaced: Windows refuses to change files a
 * running program has open, or the folder it runs in. Returns whether it was running, so the
 * caller can start it again afterwards.
 * @param {(message: string, initialValue?: boolean) => Promise<boolean>} confirm
 * @param {ReturnType<typeof getConfig>} [cfg]
 */
export async function stopComfyForUpdate(confirm, cfg = getConfig()) {
  if (!(await httpGetOk(`${cfg.comfyUrl}/system_stats`))) return false;
  const rec = readPids().comfy;
  const pid = rec?.owned && rec.pid && isPidAlive(rec.pid) ? rec.pid : findLocalComfy(cfg)?.pid;
  if (!pid) {
    throw new Error(`ComfyUI is running at ${cfg.comfyUrl}, but not from this install as far as Darkroom can tell. Close it, then update again.`);
  }
  if (!(await confirm('ComfyUI is running. Stop it while this runs? (It starts again afterwards.)', true))) {
    throw new Error('Skipped: ComfyUI is still running.');
  }
  killTree(pid);
  clearPid('comfy');
  // Python can take a few seconds to unload models and exit
  for (let i = 0; i < 40 && isPidAlive(pid); i++) await sleep(500);
  if (isPidAlive(pid)) throw new Error(`ComfyUI (pid ${pid}) didn't stop. Close it, then update again.`);
  return true;
}

/**
 * Run `fn` with this install's ComfyUI stopped (asks first), then start it again if it was
 * running. Windows can't replace files ComfyUI has open (its Python packages, the folder it
 * runs in); on every OS, new code and packages only load when ComfyUI starts.
 * @template T
 * @param {(message: string, initialValue?: boolean) => Promise<boolean>} confirm
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withComfyStopped(confirm, fn) {
  const wasRunning = await stopComfyForUpdate(confirm);
  try {
    return await fn();
  } finally {
    if (wasRunning) {
      console.log('Starting ComfyUI again…');
      startComfyProcess();
    }
  }
}

/**
 * withComfyStopped for a component action — unless the caller already stopped ComfyUI for a
 * batch (ctx.comfyStopped), so one Update stops and restarts it once.
 * @template T
 * @param {{ confirm?: (message: string, initialValue?: boolean) => Promise<boolean>, comfyStopped?: boolean }} ctx
 * @param {(message: string, initialValue?: boolean) => Promise<boolean>} defaultConfirm
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function comfyStoppedFor(ctx, defaultConfirm, fn) {
  return ctx.comfyStopped ? fn() : withComfyStopped(ctx.confirm || defaultConfirm, fn);
}
