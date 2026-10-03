import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');

// DARKROOM_ENV_FILE points elsewhere (tests use a temp file, never the real .env)
export const envPath = process.env.DARKROOM_ENV_FILE ? path.resolve(process.env.DARKROOM_ENV_FILE) : path.join(rootDir, '.env');

export function getComfyDir(): string {
  return process.env.COMFY_DIR || readEnvValue('COMFY_DIR') || '';
}

/**
 * Resolve ComfyUI source root (folder with main.py / execution.py).
 * Windows portable: COMFY_DIR/ComfyUI ; macOS: COMFY_DIR itself.
 */
export function getComfyUiRoot(comfyDir = getComfyDir()): string | null {
  if (!comfyDir) return null;
  const resolved = path.resolve(comfyDir);
  if (fs.existsSync(path.join(resolved, 'ComfyUI', 'main.py'))) {
    return path.join(resolved, 'ComfyUI');
  }
  if (fs.existsSync(path.join(resolved, 'main.py'))) return resolved;
  return resolved;
}

/**
 * Detect whether this ComfyUI build accepts per-prompt preview_method in
 * extra_data (PR #11261 / set_preview_method(extra_data.get(...))).
 */
export function supportsPerPromptPreviewMethod(): boolean {
  if (process.env.MOCK === 'true') return true;

  const uiRoot = getComfyUiRoot();
  if (!uiRoot) return false;

  const candidates = [
    path.join(uiRoot, 'execution.py'),
    path.join(uiRoot, 'comfy_execution', 'execution.py'),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const src = fs.readFileSync(file, 'utf8');
      if (
        src.includes('set_preview_method(extra_data.get("preview_method")') ||
        src.includes("set_preview_method(extra_data.get('preview_method')") ||
        /set_preview_method\(\s*extra_data\.get\(\s*["']preview_method["']/.test(src)
      ) {
        return true;
      }
    } catch {
      // ignore read errors
    }
  }
  return false;
}

export function qualityToPreviewMethod(quality: 'fast' | 'detailed'): 'latent2rgb' | 'taesd' {
  return quality === 'fast' ? 'latent2rgb' : 'taesd';
}

/** Read a single key from .env without requiring dotenv. */
export function readEnvValue(key: string, file = envPath): string | null {
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return null;
}

/** Upsert KEY=value in .env (creates the file if missing). */
export function upsertEnvValue(key: string, value: string, file = envPath): void {
  const line = `${key}=${value}`;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${line}\n`, 'utf8');
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
