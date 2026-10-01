import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from '../lib/paths.js';
import { detectComfyDesktopInstalls } from './desktopDetect.js';

/**
 * @typedef {{ comfyDir: string, python: string, kind: string, label: string, port?: number, url?: string }} DetectedComfy
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

  for (const desk of detectComfyDesktopInstalls()) {
    // Config-only entries (no python) are kept under a synthetic key so Use existing can pick port
    const key =
      desk.kind === 'desktop-config'
        ? `desktop-config:${desk.port}:${desk.comfyDir}`
        : path.resolve(desk.comfyDir);
    if (!found.has(key) || desk.kind === 'desktop') {
      found.set(key, desk);
    }
  }

  return [...found.values()];
}

/** ComfyUI: 3.10–3.13 preferred; 3.14 works but custom nodes may break. */
export const PYTHON_MIN = [3, 10];
export const PYTHON_MAX_PREFERRED = [3, 13];
export const PYTHON_MAX = [3, 14];

/**
 * Prefer stable versions first (3.12 → 3.13 → 3.11 → 3.10), then 3.14 / bare `python3`.
 * @returns {string[]}
 */
export function systemPythonCandidates() {
  if (process.platform === 'win32') {
    return [
      'py -3.12',
      'py -3.13',
      'py -3.11',
      'py -3.10',
      'py -3.14',
      'python3.12',
      'python3.13',
      'python3.11',
      'python3.10',
      'python3.14',
      'python.exe',
      'python',
      'py',
    ];
  }
  return [
    'python3.12',
    'python3.13',
    'python3.11',
    'python3.10',
    'python3.14',
    'python3',
    'python',
  ];
}

/**
 * @param {string} executable
 * @returns {[number, number] | null}
 */
export function getPythonVersionTuple(executable) {
  const r = spawnSync(
    executable,
    ['-c', 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")'],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 },
  );
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  const m = r.stdout.trim().match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

/**
 * @param {[number, number]} ver
 * @param {[number, number]} min
 * @param {[number, number]} max
 */
function versionInRange(ver, min, max) {
  const [a, b] = ver;
  if (a < min[0] || (a === min[0] && b < min[1])) return false;
  if (a > max[0] || (a === max[0] && b > max[1])) return false;
  return true;
}

/**
 * Resolve a command (possibly `py -3.12`) to an absolute interpreter path + version.
 * @param {string} cmd
 * @returns {{ executable: string, version: [number, number] } | null}
 */
function resolvePythonCommand(cmd) {
  const parts = cmd.split(/\s+/);
  const bin = parts[0];
  const args = [
    ...parts.slice(1),
    '-c',
    'import sys; print(sys.executable); print(f"{sys.version_info[0]}.{sys.version_info[1]}")',
  ];
  const r = spawnSync(bin, args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
    timeout: 15_000,
  });
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  const lines = r.stdout
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const executable = lines[lines.length - 2] || lines[0];
  const verLine = lines[lines.length - 1] || '';
  const m = verLine.match(/^(\d+)\.(\d+)/);
  if (!executable || !m) return null;
  return { executable, version: [Number(m[1]), Number(m[2])] };
}

/**
 * Pick best system Python in the supported range (prefers 3.12/3.13 over 3.14).
 * @returns {{ executable: string, version: [number, number] } | null}
 */
export function findSystemPythonInfo() {
  /** @type {{ executable: string, version: [number, number] } | null} */
  let fallback314 = null;
  for (const cmd of systemPythonCandidates()) {
    const hit = resolvePythonCommand(cmd);
    if (!hit) continue;
    if (!versionInRange(hit.version, PYTHON_MIN, PYTHON_MAX)) continue;
    if (versionInRange(hit.version, PYTHON_MIN, PYTHON_MAX_PREFERRED)) {
      return hit;
    }
    if (!fallback314) fallback314 = hit;
  }
  return fallback314;
}

/**
 * Pick first working system python in the supported range.
 * @returns {string | null}
 */
export function findSystemPython() {
  return findSystemPythonInfo()?.executable || null;
}
