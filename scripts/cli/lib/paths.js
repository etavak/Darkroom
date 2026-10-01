import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Darkroom repo root */
export const root = path.resolve(__dirname, '../../..');
export const envPath = path.join(root, '.env');
export const logsDir = path.join(root, 'logs');
export const pidPath = path.join(logsDir, 'pids.json');
export const clientDist = path.join(root, 'client', 'dist');
export const serverEntry = path.join(root, 'server', 'dist', 'index.js');
export const checkpointsPath = path.join(root, 'server', 'presets', 'checkpoints.json');
export const familiesDir = path.join(root, 'server', 'presets', 'families');
export const tagsDir = path.join(root, 'server', 'tags');

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
  lora: 'loras',
  vae: 'vae',
  upscaler: 'upscale_models',
  embedding: 'embeddings',
  controlnet: 'controlnet',
};

export function modelDirForType(type, comfyDir = process.env.COMFY_DIR || '') {
  const rootModels = getModelsRoot(comfyDir);
  if (!rootModels) return null;
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
