import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { pingComfy } from '../services/comfyClient.js';

export const comfyRouter = Router();

function resolveUiRoot(comfyDir: string) {
  if (fs.existsSync(path.join(comfyDir, 'ComfyUI', 'main.py'))) {
    return { portable: comfyDir, ui: path.join(comfyDir, 'ComfyUI') };
  }
  if (fs.existsSync(path.join(comfyDir, 'main.py'))) {
    return { portable: comfyDir, ui: comfyDir };
  }
  return null;
}

comfyRouter.post('/start', async (_req, res) => {
  if ((process.env.COMFY_MODE || 'local').toLowerCase() === 'remote') {
    res.status(400).json({ error: 'Cannot start ComfyUI in remote mode' });
    return;
  }
  if (await pingComfy()) {
    res.json({ ok: true, alreadyRunning: true });
    return;
  }
  const comfyDir = process.env.COMFY_DIR || '';
  if (!comfyDir || !fs.existsSync(comfyDir)) {
    res.status(400).json({
      error: 'COMFY_DIR is not set or missing. Run the Darkroom setup wizard first.',
    });
    return;
  }
  const roots = resolveUiRoot(comfyDir);
  if (!roots) {
    res.status(400).json({ error: 'Could not find ComfyUI main.py under COMFY_DIR' });
    return;
  }

  try {
    const url = new URL(config.comfyUrl);
    const port = url.port || '8188';
    const listen = '127.0.0.1';
    const logDir = path.join(path.dirname(config.dataDir), '..', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'comfyui.log');
    const out = fs.openSync(logFile, 'a');

    if (process.platform === 'win32') {
      const python = path.join(roots.portable, 'python_embeded', 'python.exe');
      const mainPy = path.join(roots.ui, 'main.py');
      if (!fs.existsSync(python) || !fs.existsSync(mainPy)) {
        res.status(400).json({ error: 'Windows portable Python or main.py missing' });
        return;
      }
      const child = spawn(
        python,
        [
          '-s',
          mainPy,
          '--windows-standalone-build',
          '--listen',
          listen,
          '--port',
          String(port),
        ],
        { cwd: roots.portable, detached: true, stdio: ['ignore', out, out], windowsHide: true },
      );
      child.unref();
    } else {
      const python =
        process.env.COMFY_PYTHON ||
        (fs.existsSync(path.join(roots.ui, 'venv', 'bin', 'python'))
          ? path.join(roots.ui, 'venv', 'bin', 'python')
          : fs.existsSync(path.join(roots.ui, '.venv', 'bin', 'python'))
            ? path.join(roots.ui, '.venv', 'bin', 'python')
            : 'python3');
      const child = spawn(
        python,
        ['main.py', '--listen', listen, '--port', String(port)],
        { cwd: roots.ui, detached: true, stdio: ['ignore', out, out] },
      );
      child.unref();
    }
    fs.closeSync(out);
    res.json({ ok: true, alreadyRunning: false });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start' });
  }
});
