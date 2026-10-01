import fs from 'node:fs';
import { envPath } from './paths.js';

/** @returns {Record<string, string>} */
export function loadEnvFile(file = envPath) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function applyEnv(fileEnv) {
  for (const [k, v] of Object.entries(fileEnv)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export function loadAndApplyEnv() {
  applyEnv(loadEnvFile());
}

export function envFileExists() {
  return fs.existsSync(envPath);
}

export function isRemoteMode() {
  loadAndApplyEnv();
  return (process.env.COMFY_MODE || 'local').toLowerCase() === 'remote';
}

export function getConfig() {
  loadAndApplyEnv();
  const comfyUrl = (process.env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const port = Number(process.env.PORT || 3001);
  const mode = (process.env.COMFY_MODE || 'local').toLowerCase() === 'remote' ? 'remote' : 'local';
  return {
    comfyUrl,
    comfyDir: process.env.COMFY_DIR || '',
    port,
    appUrl: `http://127.0.0.1:${port}`,
    civitaiToken: process.env.CIVITAI_TOKEN || '',
    hfToken: process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || '',
    mode,
    remote: mode === 'remote',
  };
}
