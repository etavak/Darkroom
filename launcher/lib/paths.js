import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Darkroom folder (this file is launcher/lib/paths.js) */
export const root = path.resolve(__dirname, '../..');
/** The launcher's own code */
export const launcherDir = path.join(root, 'launcher');
/**
 * Everything Darkroom downloads to run: ComfyUI and the portable tools (Node, uv, git).
 * Older installs kept these straight in the Darkroom folder; they keep working there
 * until moved (launcher → Doctor → Tidy up folders).
 */
export const dependenciesDir = path.join(root, 'dependencies');
// DARKROOM_ENV_FILE points elsewhere (tests use a temp file, never the real .env)
export const envPath = process.env.DARKROOM_ENV_FILE ? path.resolve(process.env.DARKROOM_ENV_FILE) : path.join(root, '.env');
export const logsDir = path.join(root, 'logs');
export const opsLogDir = path.join(logsDir, 'ops');
export const pidPath = path.join(logsDir, 'pids.json');
export const clientDist = path.join(root, 'client', 'dist');
export const serverEntry = path.join(root, 'server', 'dist', 'index.js');
/** Shipped default filename → family mappings (read-only at runtime) */
export const checkpointsPath = path.join(root, 'server', 'presets', 'checkpoints.json');
/** The user's own mappings — kept under server/data so updates never touch them */
export const userCheckpointsPath = path.join(root, 'server', 'data', 'checkpoints.json');
export const familiesDir = path.join(root, 'server', 'presets', 'families');
export const modelComponentsPath = path.join(root, 'server', 'presets', 'components.json');
export const tagsDir = path.join(root, 'server', 'tags');

/** Self-contained runtime (portable node, uv, MinGit, restore points) — dependencies/runtime, or the older ./runtime */
export const legacyRuntimeDir = path.join(root, 'runtime');
export const runtimeDir =
  !fs.existsSync(path.join(dependenciesDir, 'runtime')) && fs.existsSync(legacyRuntimeDir)
    ? legacyRuntimeDir
    : path.join(dependenciesDir, 'runtime');
export const runtimeNodeDir = path.join(runtimeDir, 'node');
export const runtimeUvDir = path.join(runtimeDir, 'uv');
export const runtimeGitDir = path.join(runtimeDir, 'git');
export const restorePointsDir = path.join(runtimeDir, 'restore-points');
export const componentsJsonPath = path.join(launcherDir, 'components.json');

/**
 * Where a new ComfyUI is installed: dependencies/ComfyUI (Windows: the portable build's
 * folder). An existing one straight in the Darkroom folder is still found by detect.
 */
export function defaultComfyDir() {
  return path.join(dependenciesDir, process.platform === 'win32' ? 'ComfyUI_windows_portable' : 'ComfyUI');
}

/** ComfyUI installed straight in the Darkroom folder by an older version, if any. */
export function legacyComfyDir() {
  for (const name of ['ComfyUI', 'ComfyUI_windows_portable']) {
    const dir = path.join(root, name);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

/**
 * Resolve ComfyUI source root (folder with main.py).
 * Windows portable: COMFY_DIR/ComfyUI ; macOS: COMFY_DIR itself.
 */
export function getComfyUiRoot(comfyDir = process.env.COMFY_DIR || '') {
  if (!comfyDir) return null;
  const resolved = path.resolve(comfyDir);
  if (fs.existsSync(path.join(resolved, 'ComfyUI', 'main.py'))) {
    return path.join(resolved, 'ComfyUI');
  }
  if (fs.existsSync(path.join(resolved, 'main.py'))) return resolved;
  return resolved;
}

/** Portable root (parent of ComfyUI) on Windows; same as UI root on macOS. */
export function getComfyPortableRoot(comfyDir = process.env.COMFY_DIR || '') {
  if (!comfyDir) return null;
  return path.resolve(comfyDir);
}

export function getModelsRoot(comfyDir = process.env.COMFY_DIR || '') {
  const ui = getComfyUiRoot(comfyDir);
  if (!ui) return null;
  return path.join(ui, 'models');
}

export function getCustomNodesDir(comfyDir = process.env.COMFY_DIR || '') {
  const ui = getComfyUiRoot(comfyDir);
  if (!ui) return null;
  return path.join(ui, 'custom_nodes');
}

/** @type {Record<string, string>} */
export const MODEL_SUBDIRS = {
  checkpoint: 'checkpoints',
  diffusion: 'diffusion_models',
  text_encoder: 'text_encoders',
  lora: 'loras',
  vae: 'vae',
  upscaler: 'upscale_models',
  embedding: 'embeddings',
  controlnet: 'controlnet',
  /** Face / hand finders for the face detailer (Impact Subpack's UltralyticsDetectorProvider) */
  detector: 'ultralytics/bbox',
};

/**
 * Resolve models subfolder for a type.
 * Diffusion GGUFs go in models/unet (ComfyUI-GGUF); TE GGUFs stay in text_encoders.
 * @param {string} type
 * @param {string} [comfyDir]
 * @param {{ filename?: string }} [opts]
 */
export function modelDirForType(type, comfyDir = process.env.COMFY_DIR || '', opts = {}) {
  const rootModels = getModelsRoot(comfyDir);
  if (!rootModels) return null;
  const filename = String(opts.filename || '').toLowerCase();
  if (type === 'diffusion' && filename.endsWith('.gguf')) {
    return path.join(rootModels, 'unet');
  }
  const sub = MODEL_SUBDIRS[type];
  if (!sub) return null;
  return path.join(rootModels, sub);
}

export function getComfyPython(comfyDir = process.env.COMFY_DIR || '') {
  if (process.env.COMFY_PYTHON && fs.existsSync(process.env.COMFY_PYTHON)) {
    return process.env.COMFY_PYTHON;
  }
  const portable = getComfyPortableRoot(comfyDir);
  const ui = getComfyUiRoot(comfyDir);
  if (!portable || !ui) return process.env.COMFY_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

  if (process.platform === 'win32') {
    const embedded = path.join(portable, 'python_embeded', 'python.exe');
    if (fs.existsSync(embedded)) return embedded;
    const venv = path.join(ui, 'venv', 'Scripts', 'python.exe');
    if (fs.existsSync(venv)) return venv;
    const dot = path.join(ui, '.venv', 'Scripts', 'python.exe');
    if (fs.existsSync(dot)) return dot;
  } else {
    for (const rel of ['venv/bin/python', '.venv/bin/python', 'venv/bin/python3', '.venv/bin/python3']) {
      const candidate = path.join(ui, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return process.env.COMFY_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

export function ensureLogsDir() {
  fs.mkdirSync(logsDir, { recursive: true });
}

export function ensureRuntimeDirs() {
  for (const dir of [runtimeDir, runtimeNodeDir, runtimeUvDir, runtimeGitDir, restorePointsDir, opsLogDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Portable Node folders under runtime/node, newest version first.
 * Layout: runtime/node/node-vX.Y.Z-<platform>-<arch>/bin/node (Unix)
 *         runtime/node/node-vX.Y.Z-win-x64/node.exe (Windows)
 * @param {string} [nodeDir] runtime/node (tests pass a scratch folder)
 * @returns {{ dir: string, bin: string, version: number[] }[]}
 */
export function listPortableNodes(nodeDir = runtimeNodeDir) {
  if (!fs.existsSync(nodeDir)) return [];
  const out = [];
  for (const e of fs.readdirSync(nodeDir, { withFileTypes: true })) {
    const m = e.isDirectory() && e.name.match(/^node-v(\d+)\.(\d+)\.(\d+)-/);
    if (!m) continue;
    const dir = path.join(nodeDir, e.name);
    const bin = process.platform === 'win32' ? path.join(dir, 'node.exe') : path.join(dir, 'bin', 'node');
    if (fs.existsSync(bin)) out.push({ dir, bin, version: m.slice(1, 4).map(Number) });
  }
  return out.sort((a, b) => b.version[0] - a.version[0] || b.version[1] - a.version[1] || b.version[2] - a.version[2]);
}

/** The newest portable Node binary, if any. */
export function getPortableNodeBin() {
  return listPortableNodes()[0]?.bin ?? null;
}

/**
 * uv binary under runtime/uv
 */
export function getUvBin() {
  const name = process.platform === 'win32' ? 'uv.exe' : 'uv';
  const candidate = path.join(runtimeUvDir, name);
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * MinGit / portable git under runtime/git (Windows), else `git` on PATH
 */
export function getGitBin() {
  if (process.platform === 'win32') {
    const portable = path.join(runtimeGitDir, 'cmd', 'git.exe');
    if (fs.existsSync(portable)) return portable;
    const mingw = path.join(runtimeGitDir, 'mingw64', 'bin', 'git.exe');
    if (fs.existsSync(mingw)) return mingw;
  }
  return 'git';
}

