import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Detect ComfyUI Desktop (Electron) app installs and configured port.
 * @typedef {{ comfyDir: string, python: string, kind: string, label: string, port?: number, url?: string }} DetectedComfy
 */

/**
 * Common Desktop data / install roots on macOS.
 * @returns {string[]}
 */
function desktopCandidateRoots() {
  const home = os.homedir();
  /** @type {string[]} */
  const out = [];
  if (process.platform === 'darwin') {
    out.push(
      path.join(home, 'Library', 'Application Support', 'ComfyUI'),
      path.join(home, 'Documents', 'ComfyUI'),
      '/Applications/ComfyUI.app',
      path.join(home, 'Applications', 'ComfyUI.app'),
    );
  } else if (process.platform === 'win32') {
    // Settings (config.json with basePath) live in Roaming AppData; the app in Local AppData
    const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    out.push(
      path.join(roaming, 'ComfyUI'),
      path.join(home, 'Documents', 'ComfyUI'),
      path.join(local, 'Programs', '@comfyorgcomfyui-electron'),
      path.join(local, 'Programs', 'ComfyUI'),
      path.join(local, 'ComfyUI'),
    );
  } else {
    out.push(path.join(home, '.config', 'ComfyUI'));
  }
  return out;
}

/**
 * Read port from Desktop config JSON if present.
 * @param {string} root
 * @returns {{ port: number, url?: string } | null}
 */
export function readDesktopComfyConfig(root) {
  const candidates = [
    path.join(root, 'config.json'),
    path.join(root, 'comfyui.json'),
    path.join(root, 'user', 'default', 'comfy.settings.json'),
    path.join(root, 'settings.json'),
    // Electron userData often nests extra
    path.join(root, 'ComfyUI', 'config.json'),
  ];

  // Also scan *.json shallowly for port-like keys
  if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
    try {
      for (const name of fs.readdirSync(root)) {
        if (!name.endsWith('.json')) continue;
        candidates.push(path.join(root, name));
      }
    } catch {
      // ignore
    }
  }

  for (const file of candidates) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      const port = pickPort(json);
      if (port) {
        return { port, url: `http://127.0.0.1:${port}` };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * @param {any} obj
 * @returns {number | null}
 */
function pickPort(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const keys = [
    'port',
    'ComfyUI_PORT',
    'comfyPort',
    'Comfy.Server.Port',
    'serverPort',
    'listenPort',
  ];
  for (const k of keys) {
    if (k in obj) {
      const n = Number(obj[k]);
      if (Number.isFinite(n) && n > 0 && n < 65536) return n;
    }
  }
  // Nested Comfy Desktop settings
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = pickPort(v);
      if (nested) return nested;
    }
  }
  // String URL with port
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
      try {
        const u = new URL(v);
        if (u.port) return Number(u.port);
      } catch {
        // ignore
      }
    }
  }
  return null;
}

/**
 * Find Python inside a Desktop app bundle / install.
 * @param {string} root
 */
function findDesktopPython(root) {
  // The Desktop app keeps its Python environment in <base path>/.venv
  const venvs = ['.venv', 'venv', path.join('ComfyUI', '.venv'), path.join('ComfyUI', 'venv'), path.join('resources', 'ComfyUI', 'venv')];
  const candidates = [
    ...venvs.map((v) => path.join(root, v, 'Scripts', 'python.exe')),
    ...venvs.map((v) => path.join(root, v, 'bin', 'python')),
    path.join(root, 'resources', 'python', 'bin', 'python'),
    path.join(root, 'Contents', 'Resources', 'ComfyUI', 'venv', 'bin', 'python'),
    path.join(root, 'Contents', 'Resources', 'python', 'bin', 'python3'),
    path.join(root, 'python_embeded', 'python.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Find main.py under Desktop layout.
 * @param {string} root
 */
function findDesktopUiRoot(root) {
  const candidates = [
    path.join(root, 'resources', 'ComfyUI'),
    path.join(root, 'Contents', 'Resources', 'ComfyUI'),
    path.join(root, 'ComfyUI'),
    root,
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'main.py'))) return c;
  }
  return null;
}

/**
 * The Desktop app's base path (models, custom nodes, .venv) from its config.json.
 * @param {string} root
 * @returns {string | null}
 */
function desktopBasePath(root) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    return typeof cfg.basePath === 'string' && fs.existsSync(cfg.basePath) ? cfg.basePath : null;
  } catch {
    return null;
  }
}

/** Where the Desktop app's own copy of ComfyUI (main.py) is installed. */
function desktopAppUiRoots() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return ['/Applications/ComfyUI.app', path.join(home, 'Applications', 'ComfyUI.app')].map((a) => path.join(a, 'Contents', 'Resources', 'ComfyUI'));
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return ['@comfyorgcomfyui-electron', 'ComfyUI'].map((d) => path.join(local, 'Programs', d, 'resources', 'ComfyUI'));
  }
  return [];
}

/**
 * @returns {DetectedComfy[]}
 */
export function detectComfyDesktopInstalls() {
  /** @type {DetectedComfy[]} */
  const found = [];
  // App settings name the base path: its .venv runs the app's ComfyUI
  const roots = desktopCandidateRoots();
  for (const root of [...roots]) {
    const base = desktopBasePath(root);
    if (!base || roots.includes(base)) continue;
    roots.push(base);
    const ui = desktopAppUiRoots().find((u) => fs.existsSync(path.join(u, 'main.py')));
    const python = findDesktopPython(base);
    if (ui && python) {
      found.push({ comfyDir: ui, python, kind: 'desktop', label: `Desktop · ${base}`, ...readDesktopComfyConfig(root) });
    }
  }
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;

    // App Support folder may only have config — pair with app bundle
    const cfg = readDesktopComfyConfig(root);
    const uiRoot = findDesktopUiRoot(root);
    const python = findDesktopPython(root) || (uiRoot ? findDesktopPython(path.dirname(uiRoot)) : null);

    if (uiRoot && python) {
      const ver = spawnSync(python, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15_000,
      });
      if (ver.error || (ver.status !== 0 && ver.status !== null)) continue;
      found.push({
        comfyDir: uiRoot,
        python,
        kind: 'desktop',
        label: `Desktop · ${root}`,
        port: cfg?.port,
        url: cfg?.url,
      });
      continue;
    }

    // Config-only: still useful for port when pointing at a known source install
    if (cfg?.port) {
      found.push({
        comfyDir: root,
        python: '',
        kind: 'desktop-config',
        label: `Desktop config · port ${cfg.port} · ${root}`,
        port: cfg.port,
        url: cfg.url,
      });
    }
  }
  return found;
}
