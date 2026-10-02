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

/**
 * @param {Record<string, string>} fileEnv
 * @param {{ overwrite?: boolean }} [opts]
 */
export function applyEnv(fileEnv, opts = {}) {
  const overwrite = opts.overwrite === true;
  for (const [k, v] of Object.entries(fileEnv)) {
    if (overwrite || process.env[k] === undefined) process.env[k] = v;
  }
  if (overwrite) {
    // Drop local-only keys when switching to remote so getConfig() stays accurate.
    if ((fileEnv.COMFY_MODE || '').toLowerCase() === 'remote') {
      delete process.env.COMFY_DIR;
      delete process.env.COMFY_PYTHON;
    }
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

/**
 * Upsert KEY=value in .env (creates the file if missing).
 * @param {string} key
 * @param {string} value
 * @param {string} [file]
 */
export function upsertEnvValue(key, value, file = envPath) {
  const line = `${key}=${value}`;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${line}\n`, 'utf8');
    process.env[key] = value;
    return;
  }

  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);
  let found = false;
  const next = lines.map((l) => {
    const trimmed = l.trim();
    if (!trimmed || trimmed.startsWith('#')) return l;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return l;
    if (trimmed.slice(0, eq).trim() !== key) return l;
    found = true;
    return line;
  });

  if (!found) {
    if (next.length > 0 && next[next.length - 1] !== '') next.push('');
    next.push(line);
  }

  fs.writeFileSync(file, next.join('\n').replace(/\n+$/, '\n'), 'utf8');
  process.env[key] = value;
}
