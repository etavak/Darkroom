import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from '../lib/paths.js';

/**
 * @typedef {{ comfyDir: string, python: string, kind: string, label: string }} DetectedComfy
 */

/**
 * @param {string} dir
 * @returns {DetectedComfy | null}
 */
export function validateComfyInstall(dir) {
  if (!dir) return null;
  const resolved = path.resolve(dir.trim().replace(/^~(?=$|[/\\])/, os.homedir()));
  if (!fs.existsSync(resolved)) return null;

  let uiRoot = resolved;
  let portableRoot = resolved;
  if (fs.existsSync(path.join(resolved, 'ComfyUI', 'main.py'))) {
    uiRoot = path.join(resolved, 'ComfyUI');
    portableRoot = resolved;
  } else if (!fs.existsSync(path.join(resolved, 'main.py'))) {
    return null;
  }

  const python = resolvePythonForInstall(portableRoot, uiRoot);
  if (!python) return null;

  const ver = spawnSync(python, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  if (ver.error || (ver.status !== 0 && ver.status !== null)) return null;

  const kind = fs.existsSync(path.join(portableRoot, 'python_embeded', 'python.exe'))
    ? 'portable'
    : 'source';

  return {
    comfyDir: kind === 'portable' ? portableRoot : uiRoot,
    python,
    kind,
    label: `${kind === 'portable' ? 'Portable' : 'Source'} · ${resolved}`,
  };
}

/**
 * @param {string} portableRoot
 * @param {string} uiRoot
 */
export function resolvePythonForInstall(portableRoot, uiRoot) {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(path.join(portableRoot, 'python_embeded', 'python.exe'));
    candidates.push(path.join(uiRoot, 'python_embeded', 'python.exe'));
    candidates.push(path.join(uiRoot, 'venv', 'Scripts', 'python.exe'));
    candidates.push(path.join(uiRoot, '.venv', 'Scripts', 'python.exe'));
  } else {
    candidates.push(path.join(uiRoot, 'venv', 'bin', 'python'));
    candidates.push(path.join(uiRoot, '.venv', 'bin', 'python'));
    candidates.push(path.join(uiRoot, 'venv', 'bin', 'python3'));
    candidates.push(path.join(uiRoot, '.venv', 'bin', 'python3'));
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** @returns {DetectedComfy[]} */
export function detectComfyInstalls() {
  /** @type {string[]} */
  const search = [];
  const home = os.homedir();

  search.push(
    path.join(home, 'ComfyUI'),
    path.join(home, 'comfyui'),
    path.join(home, 'ComfyUI_windows_portable'),
    path.join(home, 'Documents', 'ComfyUI'),
    path.join(home, 'Documents', 'ComfyUI_windows_portable'),
    path.join(home, 'Desktop', 'ComfyUI'),
    path.join(home, 'Desktop', 'ComfyUI_windows_portable'),
    path.join(home, 'Downloads', 'ComfyUI_windows_portable'),
  );

  if (process.platform === 'win32') {
    search.push(
      'C:\\ComfyUI',
      'C:\\ComfyUI_windows_portable',
      'D:\\ComfyUI',
      'D:\\ComfyUI_windows_portable',
    );
  } else {
    search.push('/opt/ComfyUI', '/usr/local/ComfyUI');
  }

  search.push(path.join(root, 'ComfyUI'), path.join(root, '..', 'ComfyUI'));
  search.push(path.join(root, 'ComfyUI_windows_portable'));
  search.push(path.join(root, '..', 'ComfyUI_windows_portable'));

  /** @type {Map<string, DetectedComfy>} */
  const found = new Map();
  for (const dir of search) {
    try {
      const hit = validateComfyInstall(dir);
      if (hit) found.set(path.resolve(hit.comfyDir), hit);
    } catch {
      // ignore
    }
  }
  return [...found.values()];
}

export function systemPythonCandidates() {
  if (process.platform === 'win32') {
    return ['python.exe', 'python', 'py'];
  }
  return ['python3', 'python'];
}

/**
 * Pick first working system python 3.10+.
 * @returns {string | null}
 */
export function findSystemPython() {
  for (const cmd of systemPythonCandidates()) {
    const r = spawnSync(
      cmd,
      ['-c', 'import sys; assert sys.version_info >= (3, 10); print(sys.executable)'],
      {
        encoding: 'utf8',
        windowsHide: true,
        shell: process.platform === 'win32',
        timeout: 15_000,
      },
    );
    if (r.status === 0 && r.stdout?.trim()) return r.stdout.trim().split(/\r?\n/).pop() || null;
  }
  return null;
}
