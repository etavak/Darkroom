import fs from 'node:fs';
import path from 'node:path';
import { loadServerSettings } from './appSettings.js';
import { getComfyUiRoot } from './envSettings.js';

/** Model architecture: a LoRA only loads on a model of the same one. */
export type LoraArch = 'sd15' | 'sdxl' | 'sd3' | 'flux' | 'flux2';

export type LoraMeta = {
  /** As ComfyUI lists it (path under a loras folder, forward slashes) */
  name: string;
  /** Model name from Civitai, when known */
  title: string | null;
  /** What it was made for, e.g. "Illustrious", "Pony", "SDXL" */
  base: string | null;
  /** Darkroom family id when the base names one (null for generic SDXL / SD 1.5 …) */
  family: string | null;
  arch: LoraArch | null;
  triggers: string[];
  /** A preview image exists (GET /api/models/loras/thumb?name=…) */
  thumb: boolean;
};

const MODEL_EXT = /\.(safetensors|ckpt|pt|pth)$/i;
const THUMB_SUFFIXES = ['.preview.jpg', '.preview.jpeg', '.preview.png', '.preview.webp', '.jpg', '.jpeg', '.png', '.webp'];

/** Base-model names (Civitai labels, training metadata, filenames) → family + architecture. */
const BASES: Array<{ re: RegExp; base: string; family: string | null; arch: LoraArch }> = [
  { re: /illustrious|\bilxl\b/i, base: 'Illustrious', family: 'illustrious', arch: 'sdxl' },
  { re: /noob/i, base: 'NoobAI', family: 'noobai', arch: 'sdxl' },
  { re: /pony/i, base: 'Pony', family: 'pony', arch: 'sdxl' },
  { re: /flux[._ -]?2|klein/i, base: 'Flux.2', family: 'flux2-klein', arch: 'flux2' },
  { re: /flux/i, base: 'Flux', family: 'flux', arch: 'flux' },
  { re: /\bsd[._ -]?3|stable-diffusion-3/i, base: 'SD3', family: 'sd3', arch: 'sd3' },
  { re: /sdxl|\bxl\b|stable-diffusion-xl/i, base: 'SDXL', family: null, arch: 'sdxl' },
  { re: /sd[._ -]?1|\bv1[-_]5\b|stable-diffusion-v1/i, base: 'SD 1.5', family: null, arch: 'sd15' },
];

function matchBase(text: unknown) {
  if (typeof text !== 'string' || !text.trim()) return null;
  return BASES.find((b) => b.re.test(text)) ?? null;
}

/** Architecture from the tensor names (kohya and diffusers layouts). */
function archFromKeys(keys: string[]): LoraArch | null {
  let te2 = false;
  let inputBlocks = false;
  let downBlocks = false;
  for (const k of keys) {
    if (k.includes('double_blocks') || k.includes('single_blocks') || k.includes('single_transformer_blocks')) return 'flux';
    if (k.includes('lora_te2_') || k.includes('text_encoder_2')) te2 = true;
    else if (k.includes('lora_unet_input_blocks') || k.includes('lora_unet_output_blocks')) inputBlocks = true;
    else if (k.includes('down_blocks')) downBlocks = true;
  }
  if (te2 || inputBlocks) return 'sdxl';
  if (downBlocks) return 'sd15';
  return null;
}

function readHeader(file: string): { meta: Record<string, unknown>; keys: string[] } | null {
  if (!file.toLowerCase().endsWith('.safetensors')) return null;
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const len = Buffer.alloc(8);
    if (fs.readSync(fd, len, 0, 8, 0) !== 8) return null;
    const n = Number(len.readBigUInt64LE(0));
    if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) return null;
    const buf = Buffer.alloc(n);
    if (fs.readSync(fd, buf, 0, n, 8) !== n) return null;
    const header = JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
    const meta = (header.__metadata__ ?? {}) as Record<string, unknown>;
    return { meta, keys: Object.keys(header).filter((k) => k !== '__metadata__') };
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string') return v.split(',');
  return [];
}

/** Folders ComfyUI loads LoRAs from: its own models/loras plus Darkroom's extra folders. */
export function loraDirs(): string[] {
  const dirs: string[] = [];
  const root = getComfyUiRoot();
  if (root) dirs.push(path.join(root, 'models', 'loras'));
  for (const f of loadServerSettings().extraModelFolders) dirs.push(path.join(path.resolve(f), 'loras'));
  return [...new Set(dirs)].filter((d) => fs.existsSync(d));
}

function walk(dir: string, rel: string, depth: number, out: Array<{ name: string; file: string }>) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    const name = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory() || (e.isSymbolicLink() && fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory())) {
      if (depth < 4) walk(abs, name, depth + 1, out);
    } else if (MODEL_EXT.test(e.name)) {
      out.push({ name, file: abs });
    }
  }
}

const cache = new Map<string, { mtimeMs: number; meta: LoraMeta; thumbFile: string | null }>();

function describe(name: string, file: string): { meta: LoraMeta; thumbFile: string | null } {
  const stem = file.replace(MODEL_EXT, '');
  const darkroom = readJson(`${stem}.darkroom.json`);
  const civitai = readJson(`${stem}.civitai.info`);
  const header = readHeader(file);
  const m = header?.meta ?? {};

  // Most reliable first: Civitai's label, then training metadata, then the file name
  const fromLabel =
    matchBase(civitai?.baseModel) ??
    matchBase(darkroom?.baseModel) ??
    matchBase(m.ss_sd_model_name) ??
    matchBase(m['modelspec.architecture']) ??
    matchBase(m.ss_base_model_version);
  const keyArch = header ? archFromKeys(header.keys) : null;
  let base = fromLabel;
  if (!base && keyArch) {
    // The file name can still say which SDXL family it was trained on
    const byName = matchBase(path.basename(stem));
    base = byName && byName.arch === keyArch ? byName : BASES.find((b) => b.arch === keyArch && !b.family) ?? BASES.find((b) => b.arch === keyArch) ?? null;
  }

  const triggers = [
    ...strList(darkroom?.triggerWords),
    ...strList(civitai?.trainedWords),
    ...strList(m['modelspec.trigger_phrase']),
  ]
    .map((t) => t.trim())
    .filter((t, i, a) => t && t.length <= 80 && a.indexOf(t) === i)
    .slice(0, 12);

  const civModel = civitai?.model as { name?: unknown } | undefined;
  const title =
    (typeof darkroom?.modelName === 'string' && darkroom.modelName) ||
    (typeof civModel?.name === 'string' && civModel.name) ||
    (typeof m['modelspec.title'] === 'string' && (m['modelspec.title'] as string)) ||
    null;

  const thumbFile = THUMB_SUFFIXES.map((s) => stem + s).find((f) => fs.existsSync(f)) ?? null;
  return {
    meta: { name, title, base: base?.base ?? null, family: base?.family ?? null, arch: base?.arch ?? keyArch, triggers, thumb: Boolean(thumbFile) },
    thumbFile,
  };
}

/** Every LoRA on disk with what it was made for, trigger words and whether it has a preview. */
export function listLoraMeta(): LoraMeta[] {
  const files: Array<{ name: string; file: string }> = [];
  for (const d of loraDirs()) walk(d, '', 0, files);
  const seen = new Set<string>();
  const out: LoraMeta[] = [];
  for (const f of files) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    const mtimeMs = fs.statSync(f.file, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    const key = f.file;
    let hit = cache.get(key);
    if (!hit || hit.mtimeMs !== mtimeMs) {
      hit = { mtimeMs, ...describe(f.name, f.file) };
      cache.set(key, hit);
    }
    out.push(hit.meta);
  }
  return out;
}

/** Preview image for a LoRA listed by listLoraMeta (names outside the loras folders resolve to null). */
export function loraThumbFile(name: string): string | null {
  for (const hit of cache.values()) if (hit.meta.name === name) return hit.thumbFile;
  listLoraMeta();
  for (const hit of cache.values()) if (hit.meta.name === name) return hit.thumbFile;
  return null;
}
