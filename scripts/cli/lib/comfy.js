import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './env.js';
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

  const portable = getComfyPortableRoot(cfg.comfyDir);
  const uiRoot = getComfyUiRoot(cfg.comfyDir);
  if (!portable || !uiRoot) throw new Error('Invalid COMFY_DIR');

  ensureLogsDir();
  const logFile = path.join(logsDir, 'comfyui.log');
  fs.writeFileSync(logFile, `\n--- ${new Date().toISOString()} ---\n`, { flag: 'a' });

  const url = new URL(cfg.comfyUrl);
  const port = url.port || '8188';
  const listen = '127.0.0.1';
  // Default auto; COMFY_PREVIEW_METHOD is set by UI when per-prompt override is unavailable.
  const previewMethod = process.env.COMFY_PREVIEW_METHOD || 'auto';
  const previewArgs = ['--preview-method', previewMethod];

  let pid = 0;
  if (process.platform === 'win32') {
    const python = path.join(portable, 'python_embeded', 'python.exe');
    const mainPy = path.join(uiRoot, 'main.py');
    if (!fs.existsSync(python)) throw new Error(`Windows portable Python not found: ${python}`);
    if (!fs.existsSync(mainPy)) throw new Error(`ComfyUI main.py not found: ${mainPy}`);
    pid = spawnDetached(
      python,
      [
        '-s',
        mainPy,
        '--windows-standalone-build',
        '--listen',
        listen,
        '--port',
        String(port),
        ...previewArgs,
      ],
      { cwd: portable, logFile },
    );
  } else {
    const python = getComfyPython(cfg.comfyDir);
    const mainPy = path.join(uiRoot, 'main.py');
    if (!fs.existsSync(mainPy)) {
      throw new Error(`ComfyUI main.py not found: ${mainPy}`);
    }
    pid = spawnDetached(
      python,
      ['main.py', '--listen', listen, '--port', String(port), ...previewArgs],
      {
        cwd: uiRoot,
        logFile,
        env: {
          ...process.env,
          ...(process.platform === 'darwin'
            ? { PYTORCH_ENABLE_MPS_FALLBACK: '1' }
            : {}),
        },
      },
    );
  }

  setPid('comfy', pid, true);
  await waitForComfyReady(statsUrl, pid, logFile);
  return { started: true, alreadyRunning: false };
}
