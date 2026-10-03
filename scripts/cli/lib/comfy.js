import { spawnSync } from 'node:child_process';
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
} from './paths.js';
import { clearPid, isPidAlive, readPids, setPid, spawnDetached } from './process.js';

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
  return flags;
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

  ensureLogsDir();
  const logFile = path.join(logsDir, 'comfyui.log');
  fs.writeFileSync(logFile, `\n--- ${new Date().toISOString()} ---\n`, { flag: 'a' });

  const port = new URL(cfg.comfyUrl).port || '8188';
  const serveArgs = ['--listen', '127.0.0.1', '--port', String(port), ...comfyLaunchFlags()];

  let pid = 0;
  if (process.platform === 'win32') {
    const python = path.join(portable, 'python_embeded', 'python.exe');
    if (!fs.existsSync(python)) throw new Error(`Windows portable Python not found: ${python}`);
    pid = spawnDetached(python, ['-s', mainPy, '--windows-standalone-build', ...serveArgs], {
      cwd: portable,
      logFile,
    });
  } else {
    pid = spawnDetached(getComfyPython(cfg.comfyDir), ['main.py', ...serveArgs], {
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
    for (const pid of pids) {
      const ps = spawnSync(
        'powershell',
        ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
        { encoding: 'utf8', windowsHide: true },
      );
      // The portable build runs main.py by its full path, which includes COMFY_DIR
      if (ours(ps.stdout || '')) return { pid };
    }
    return null;
  }

  const lsof = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  for (const line of (lsof.stdout || '').split('\n')) {
    const pid = Number(line.trim());
    if (!pid) continue;
    const cmd = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '';
    // macOS / Linux run "python main.py" from inside ComfyUI, so also check the working folder
    const cwd = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout || '';
    const cwdPath = cwd.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? '';
    if (ours(cmd) || (cmd.includes('main.py') && cwdPath && path.resolve(cwdPath).toLowerCase().startsWith(dir))) return { pid };
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
