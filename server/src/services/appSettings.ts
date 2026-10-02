import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getComfyUiRoot, upsertEnvValue, readEnvValue } from './envSettings.js';

export type VramMode = 'auto' | 'low' | 'normal' | 'high';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type DeleteMode = 'trash' | 'permanent';

export type ServerSettings = {
  generateForever: boolean;
  defaultUpscaler: string;
  defaultUpscaleScale: number;
  detailerDefault: boolean;
  promptCleanupDedupe: boolean;
  promptCleanupNormalize: boolean;
  safeMode: boolean;
  wildcardsFolder: string;
  /** OpenAI-compatible base URL (e.g. https://api.openai.com/v1) */
  enhanceApiUrl: string;
  enhanceApiKey: string;
  enhanceModel: string;
  /** Write prompt/settings into saved PNG tEXt chunks */
  embedPngMetadata: boolean;
  vramMode: VramMode;
  unloadIdleMinutes: number;
  maxQueueLength: number;
  extraModelFolders: string[];
  civitaiAutoFetch: boolean;
  deleteMode: DeleteMode;
  autoBackup: boolean;
  autoBackupKeep: number;
  logLevel: LogLevel;
  experimentalFeatures: boolean;
};

export type DiskUsageInfo = {
  imagesBytes: number;
  dbBytes: number;
  trashBytes: number;
  backupsBytes: number;
  totalBytes: number;
};

export const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  generateForever: false,
  defaultUpscaler: '',
  defaultUpscaleScale: 1.5,
  detailerDefault: false,
  promptCleanupDedupe: true,
  promptCleanupNormalize: true,
  safeMode: false,
  wildcardsFolder: '',
  enhanceApiUrl: '',
  enhanceApiKey: '',
  enhanceModel: '',
  embedPngMetadata: true,
  vramMode: 'auto',
  unloadIdleMinutes: 0,
  maxQueueLength: 20,
  extraModelFolders: [],
  civitaiAutoFetch: false,
  deleteMode: 'trash',
  autoBackup: false,
  autoBackupKeep: 5,
  logLevel: 'info',
  experimentalFeatures: false,
};

const settingsPath = path.join(config.dataDir, 'settings.json');
export const trashDir = path.join(config.dataDir, 'trash');
export const backupsDir = path.join(config.dataDir, 'backups');

let cached: ServerSettings | null = null;
let lastActivityAt = Date.now();
/** True once models were freed for the current idle stretch (reset by activity). */
let unloadedSinceActivity = false;
let unloadTimer: ReturnType<typeof setInterval> | null = null;

function ensureDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(trashDir, { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.mkdirSync(config.imagesDir, { recursive: true });
}

function isVramMode(v: unknown): v is VramMode {
  return v === 'auto' || v === 'low' || v === 'normal' || v === 'high';
}

function isLogLevel(v: unknown): v is LogLevel {
  return v === 'error' || v === 'warn' || v === 'info' || v === 'debug';
}

function isDeleteMode(v: unknown): v is DeleteMode {
  return v === 'trash' || v === 'permanent';
}

function sanitize(raw: Partial<ServerSettings> | null | undefined): ServerSettings {
  const base = { ...DEFAULT_SERVER_SETTINGS, ...(raw ?? {}) };
  return {
    generateForever: Boolean(base.generateForever),
    defaultUpscaler: typeof base.defaultUpscaler === 'string' ? base.defaultUpscaler : '',
    defaultUpscaleScale:
      typeof base.defaultUpscaleScale === 'number' && Number.isFinite(base.defaultUpscaleScale)
        ? Math.min(4, Math.max(1, base.defaultUpscaleScale))
        : 1.5,
    detailerDefault: Boolean(base.detailerDefault),
    promptCleanupDedupe: Boolean(base.promptCleanupDedupe),
    promptCleanupNormalize: Boolean(base.promptCleanupNormalize),
    safeMode: Boolean(base.safeMode),
    wildcardsFolder: typeof base.wildcardsFolder === 'string' ? base.wildcardsFolder : '',
    enhanceApiUrl: typeof base.enhanceApiUrl === 'string' ? base.enhanceApiUrl : '',
    enhanceApiKey: typeof base.enhanceApiKey === 'string' ? base.enhanceApiKey : '',
    enhanceModel: typeof base.enhanceModel === 'string' ? base.enhanceModel : '',
    embedPngMetadata: base.embedPngMetadata !== false,
    vramMode: isVramMode(base.vramMode) ? base.vramMode : 'auto',
    unloadIdleMinutes:
      typeof base.unloadIdleMinutes === 'number' && Number.isFinite(base.unloadIdleMinutes)
        ? Math.max(0, Math.floor(base.unloadIdleMinutes))
        : 0,
    maxQueueLength:
      typeof base.maxQueueLength === 'number' && Number.isFinite(base.maxQueueLength)
        ? Math.min(100, Math.max(1, Math.floor(base.maxQueueLength)))
        : 20,
    extraModelFolders: Array.isArray(base.extraModelFolders)
      ? base.extraModelFolders.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      : [],
    civitaiAutoFetch: Boolean(base.civitaiAutoFetch),
    deleteMode: isDeleteMode(base.deleteMode) ? base.deleteMode : 'trash',
    autoBackup: Boolean(base.autoBackup),
    autoBackupKeep:
      typeof base.autoBackupKeep === 'number' && Number.isFinite(base.autoBackupKeep)
        ? Math.min(50, Math.max(1, Math.floor(base.autoBackupKeep)))
        : 5,
    logLevel: isLogLevel(base.logLevel) ? base.logLevel : 'info',
    experimentalFeatures: Boolean(base.experimentalFeatures),
  };
}

const LOG_RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const rawConsole = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  debug: console.debug.bind(console),
};
const noop = () => {};

/** Settings → Advanced → Log level: silence server console output below the level. */
export function applyLogLevel(level: LogLevel): void {
  const rank = LOG_RANK[level];
  console.error = rawConsole.error;
  console.warn = rank >= LOG_RANK.warn ? rawConsole.warn : noop;
  console.info = rank >= LOG_RANK.info ? rawConsole.info : noop;
  console.log = rank >= LOG_RANK.info ? rawConsole.log : noop;
  console.debug = rank >= LOG_RANK.debug ? rawConsole.debug : noop;
}

export function loadServerSettings(): ServerSettings {
  ensureDirs();
  if (cached) return cached;
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Partial<ServerSettings>;
      cached = sanitize(raw);
      return cached;
    }
  } catch {
    // fall through
  }
  // Seed vram from env if present
  const envVram = readEnvValue('COMFY_VRAM_MODE');
  const seeded = sanitize({
    vramMode: isVramMode(envVram) ? envVram : 'auto',
  });
  cached = seeded;
  return seeded;
}

const EXTRA_PATHS_BEGIN = '# >>> darkroom managed — edits inside this block are overwritten >>>';
const EXTRA_PATHS_END = '# <<< darkroom managed <<<';
/** Header of files older Darkroom builds wrote wholesale (safe to replace entirely). */
const LEGACY_EXTRA_PATHS_HEADER = '# Managed by Darkroom';

/**
 * Sync Darkroom's extra model folders into ComfyUI's extra_model_paths.yaml.
 * Only the delimited Darkroom block is rewritten; anything the user wrote is kept.
 */
function writeExtraModelPaths(folders: string[]) {
  const uiRoot = getComfyUiRoot();
  if (!uiRoot) return;
  const dest = path.join(uiRoot, 'extra_model_paths.yaml');

  let existing = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
  if (existing.startsWith(LEGACY_EXTRA_PATHS_HEADER)) existing = '';

  const begin = existing.indexOf(EXTRA_PATHS_BEGIN);
  const end = existing.indexOf(EXTRA_PATHS_END);
  let userContent = existing;
  if (begin >= 0 && end > begin) {
    userContent =
      existing.slice(0, begin) + existing.slice(end + EXTRA_PATHS_END.length);
  }
  userContent = userContent.replace(/\n{3,}/g, '\n\n').trim();

  const block: string[] = [];
  if (folders.length > 0) {
    block.push(EXTRA_PATHS_BEGIN);
    folders.forEach((folder, i) => {
      block.push(`darkroom_${i}:`);
      // JSON string syntax is valid YAML double-quoted — safe for Windows paths, colons, #
      block.push(`  base_path: ${JSON.stringify(path.resolve(folder))}`);
      block.push(`  checkpoints: checkpoints`);
      block.push(`  loras: loras`);
      block.push(`  vae: vae`);
      block.push(`  upscale_models: upscale_models`);
      block.push(`  embeddings: embeddings`);
      block.push(`  controlnet: controlnet`);
    });
    block.push(EXTRA_PATHS_END);
  }

  const next = [userContent, block.join('\n')].filter(Boolean).join('\n\n');
  if (!next) {
    if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
    return;
  }
  fs.writeFileSync(dest, `${next}\n`, 'utf8');
}

export function saveServerSettings(partial: Partial<ServerSettings>): ServerSettings {
  ensureDirs();
  const prev = loadServerSettings();
  const next = sanitize({ ...prev, ...partial });
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  cached = next;
  applyLogLevel(next.logLevel);

  // Launch-flag mirrors for the ComfyUI launcher
  upsertEnvValue('COMFY_VRAM_MODE', next.vramMode);
  upsertEnvValue('CIVITAI_AUTO_FETCH', next.civitaiAutoFetch ? 'true' : 'false');
  upsertEnvValue('DARKROOM_LOG_LEVEL', next.logLevel);

  if (
    JSON.stringify(prev.extraModelFolders) !== JSON.stringify(next.extraModelFolders)
  ) {
    writeExtraModelPaths(next.extraModelFolders);
  }
  restartUnloadWatcher(next);

  if (next.autoBackup) {
    runBackup(next.autoBackupKeep);
  }

  return next;
}

/** Generation started / in progress — postpones Unload after idle. */
export function touchActivity() {
  lastActivityAt = Date.now();
  unloadedSinceActivity = false;
}

export function getLastActivityAt() {
  return lastActivityAt;
}

async function freeComfyMemory() {
  try {
    const { config: cfg } = await import('../config.js');
    await fetch(`${cfg.comfyUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
  } catch {
    // ignore when ComfyUI is down
  }
}

export function restartUnloadWatcher(settings = loadServerSettings()) {
  if (unloadTimer) {
    clearInterval(unloadTimer);
    unloadTimer = null;
  }
  if (settings.unloadIdleMinutes <= 0) return;
  const ms = settings.unloadIdleMinutes * 60_000;
  unloadTimer = setInterval(() => {
    // Free once per idle stretch; the next generation re-arms it
    if (!unloadedSinceActivity && Date.now() - lastActivityAt >= ms) {
      unloadedSinceActivity = true;
      void freeComfyMemory();
    }
  }, Math.min(60_000, Math.max(15_000, ms / 4)));
}

function dirSizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else total += st.size;
      } catch {
        // skip
      }
    }
  };
  walk(dir);
  return total;
}

export function getDiskUsage(): DiskUsageInfo {
  ensureDirs();
  const imagesBytes = dirSizeBytes(config.imagesDir);
  const trashBytes = dirSizeBytes(trashDir);
  const backupsBytes = dirSizeBytes(backupsDir);
  let dbBytes = 0;
  try {
    if (fs.existsSync(config.dbPath)) dbBytes = fs.statSync(config.dbPath).size;
  } catch {
    dbBytes = 0;
  }
  return {
    imagesBytes,
    dbBytes,
    trashBytes,
    backupsBytes,
    totalBytes: imagesBytes + dbBytes + trashBytes + backupsBytes,
  };
}

export function runBackup(keep = loadServerSettings().autoBackupKeep): { ok: boolean; path?: string } {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupsDir, `backup-${stamp}`);
  fs.mkdirSync(dest, { recursive: true });
  try {
    if (fs.existsSync(config.dbPath)) {
      fs.copyFileSync(config.dbPath, path.join(dest, 'darkroom.db'));
    }
    if (fs.existsSync(settingsPath)) {
      fs.copyFileSync(settingsPath, path.join(dest, 'settings.json'));
    }
    // prune
    const entries = fs
      .readdirSync(backupsDir)
      .filter((n) => n.startsWith('backup-'))
      .sort()
      .reverse();
    for (const old of entries.slice(keep)) {
      fs.rmSync(path.join(backupsDir, old), { recursive: true, force: true });
    }
    return { ok: true, path: dest };
  } catch {
    return { ok: false };
  }
}

/** Move or permanently delete an image file based on deleteMode. */
export function disposeFile(filename: string): void {
  const filePath = path.join(config.imagesDir, filename);
  if (!fs.existsSync(filePath)) return;
  const mode = loadServerSettings().deleteMode;
  if (mode === 'permanent') {
    fs.unlinkSync(filePath);
    return;
  }
  ensureDirs();
  const dest = path.join(trashDir, `${Date.now()}_${path.basename(filename)}`);
  try {
    fs.renameSync(filePath, dest);
  } catch {
    fs.copyFileSync(filePath, dest);
    fs.unlinkSync(filePath);
  }
}

/** Matched as whole words (underscores count as spaces) for Safe mode. */
const RATING_TAG_RE =
  /\b(explicit|nsfw|nude|nudity|naked|sex|sexual|porn|hentai|rape|guro|loli|shota)\b/i;

/**
 * Split on commas that are not inside (), [] or {} — so weighted groups like
 * "(red hair, blue eyes:1.2)" stay one tag. Backslash escapes are respected.
 */
export function splitTopLevelTags(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      cur += ch + text[i + 1];
      i++;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

/**
 * Prompt cleanup from Settings → Generation, applied right before queueing:
 * normalize spacing, drop duplicate tags, and (positive prompt only) Safe mode.
 */
export function processPromptText(
  text: string,
  opts?: { dedupe?: boolean; normalize?: boolean; safeMode?: boolean },
): string {
  const settings = loadServerSettings();
  const dedupe = opts?.dedupe ?? settings.promptCleanupDedupe;
  const normalize = opts?.normalize ?? settings.promptCleanupNormalize;
  const safe = opts?.safeMode ?? settings.safeMode;
  if (!text || (!dedupe && !normalize && !safe)) return text ?? '';

  let tags = splitTopLevelTags(text).map((t) =>
    normalize ? t.replace(/\s+/g, ' ').trim() : t.trim(),
  );
  tags = tags.filter(Boolean);

  if (safe) {
    tags = tags.filter((t) => !RATING_TAG_RE.test(t.replace(/_/g, ' ')));
  }
  if (dedupe) {
    const seen = new Set<string>();
    tags = tags.filter((t) => {
      const key = t.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return tags.join(', ');
}

export function settingsHints(settings: ServerSettings): Partial<Record<keyof ServerSettings, string>> {
  const hints: Partial<Record<keyof ServerSettings, string>> = {};
  if (settings.vramMode !== 'auto') {
    hints.vramMode = 'Applies next ComfyUI launch';
  }
  if (settings.extraModelFolders.length > 0) {
    hints.extraModelFolders = 'Writes extra_model_paths.yaml — restart ComfyUI to pick up';
  }
  if (settings.unloadIdleMinutes > 0) {
    hints.unloadIdleMinutes = `Unloads via POST /free after ${settings.unloadIdleMinutes}m idle`;
  }
  return hints;
}

// Apply persisted runtime settings on import
applyLogLevel(loadServerSettings().logLevel);
restartUnloadWatcher(loadServerSettings());
