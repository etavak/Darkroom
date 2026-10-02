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
import { clearPid, isPidAlive, setPid, spawnDetached } from './process.js';

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
