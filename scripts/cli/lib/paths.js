import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Darkroom repo root */
export const root = path.resolve(__dirname, '../../..');
export const envPath = path.join(root, '.env');
export const logsDir = path.join(root, 'logs');
export const opsLogDir = path.join(logsDir, 'ops');
export const pidPath = path.join(logsDir, 'pids.json');
export const clientDist = path.join(root, 'client', 'dist');
export const serverEntry = path.join(root, 'server', 'dist', 'index.js');
export const checkpointsPath = path.join(root, 'server', 'presets', 'checkpoints.json');
export const familiesDir = path.join(root, 'server', 'presets', 'families');
export const modelComponentsPath = path.join(root, 'server', 'presets', 'components.json');
export const tagsDir = path.join(root, 'server', 'tags');

/** Self-contained runtime (portable node, uv, MinGit, restore points) */
export const runtimeDir = path.join(root, 'runtime');
export const runtimeNodeDir = path.join(runtimeDir, 'node');
export const runtimeUvDir = path.join(runtimeDir, 'uv');
export const runtimeGitDir = path.join(runtimeDir, 'git');
export const restorePointsDir = path.join(runtimeDir, 'restore-points');
export const componentsJsonPath = path.join(root, 'scripts', 'cli', 'components.json');

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
 * Resolve portable Node binary if present under runtime/node.
 * Layout: runtime/node/node-vX.Y.Z-<platform>-<arch>/bin/node (Unix)
 *         runtime/node/node-vX.Y.Z-win-x64/node.exe (Windows)
 */
export function getPortableNodeBin() {
  if (!fs.existsSync(runtimeNodeDir)) return null;
  const entries = fs.readdirSync(runtimeNodeDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (process.platform === 'win32') {
      const exe = path.join(runtimeNodeDir, e.name, 'node.exe');
      if (fs.existsSync(exe)) return exe;
    } else {
      const bin = path.join(runtimeNodeDir, e.name, 'bin', 'node');
      if (fs.existsSync(bin)) return bin;
    }
  }
  return null;
}

/** npm next to portable node, or null */
export function getPortableNpmBin() {
  const nodeBin = getPortableNodeBin();
  if (!nodeBin) return null;
  if (process.platform === 'win32') {
    const npmCmd = path.join(path.dirname(nodeBin), 'npm.cmd');
    return fs.existsSync(npmCmd) ? npmCmd : null;
  }
  const npm = path.join(path.dirname(nodeBin), 'npm');
  return fs.existsSync(npm) ? npm : null;
}

/** Best node to use: current process if >=22, else portable */
export function getPreferredNodeBin() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) return process.execPath;
  return getPortableNodeBin() || process.execPath;
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

