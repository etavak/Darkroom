import fs from 'node:fs';

/**
 * Read safetensors JSON header (first 8 bytes = length).
 * @param {string} filePath
 * @returns {{ header: Record<string, unknown>, keys: string[] } | null}
 */
export function readSafetensorsHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const lenBuf = Buffer.alloc(8);
    if (fs.readSync(fd, lenBuf, 0, 8, 0) !== 8) return null;
    const headerLen = Number(lenBuf.readBigUInt64LE(0));
    if (!Number.isFinite(headerLen) || headerLen <= 0 || headerLen > 100_000_000) return null;
    const headerBuf = Buffer.alloc(headerLen);
    if (fs.readSync(fd, headerBuf, 0, headerLen, 8) !== headerLen) return null;
    const header = JSON.parse(headerBuf.toString('utf8'));
    const keys = Object.keys(header).filter((k) => k !== '__metadata__');
    return { header, keys };
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @param {string} filePath
 * @returns {'checkpoint' | 'lora' | 'vae' | 'upscaler' | 'embedding' | 'controlnet' | 'unknown'}
 */
export function guessModelType(filePath) {
  const lower = filePath.toLowerCase();
  const base = lower.replace(/\\/g, '/');

  // Path hints
  if (/\/loras?\//.test(base) || /lora/i.test(pathBasename(filePath))) {
    // continue — confirm with header when possible
  }

  const parsed = readSafetensorsHeader(filePath);
  if (!parsed) {
    return guessFromFilename(filePath);
  }

  const keys = parsed.keys.map((k) => k.toLowerCase());
  const joined = keys.join('\n');
  const meta =
    parsed.header.__metadata__ && typeof parsed.header.__metadata__ === 'object'
      ? /** @type {Record<string, string>} */ (parsed.header.__metadata__)
      : {};

  const ssBase = String(meta.ss_base_model_version || meta.ss_network_module || '').toLowerCase();
  if (ssBase.includes('lora') || keys.some((k) => /lora[_]?[abud]/i.test(k) || k.includes('lora_up') || k.includes('lora_down'))) {
    return 'lora';
  }
  if (
    joined.includes('controlnet') ||
    joined.includes('control_model') ||
    keys.some((k) => k.startsWith('control_'))
  ) {
    return 'controlnet';
  }
  if (
    keys.some(
      (k) =>
        k.includes('encoder.conv_in') ||
        k.includes('decoder.conv_in') ||
        k.includes('first_stage_model') ||
        k.startsWith('decoder.') ||
        k.startsWith('encoder.'),
    ) &&
    !keys.some((k) => k.includes('diffusion_model') || k.includes('double_blocks'))
  ) {
    // VAE-only files usually lack diffusion_model
    const hasDiff = keys.some(
      (k) => k.includes('model.diffusion_model') || k.includes('diffusion_model') || k.includes('double_blocks'),
    );
    if (!hasDiff) return 'vae';
  }
  if (
    keys.some(
      (k) =>
        k.includes('body.0') ||
        k.includes('upscale') ||
        k.startsWith('model.0.') ||
        k.includes('rrdb_trunk') ||
        k.includes('conv_first'),
    ) &&
    !keys.some((k) => k.includes('diffusion_model'))
  ) {
    const looksUpscale =
      keys.some((k) => /^(body|model|upsampler|conv_first)/.test(k)) && keys.length < 500;
    if (looksUpscale) return 'upscaler';
  }
  if (
    keys.length <= 4 ||
    keys.some((k) => k.includes('string_to_param') || k.includes('emb_params') || k === '*')
  ) {
    const size = fs.statSync(filePath).size;
    if (size < 50 * 1024 * 1024) return 'embedding';
  }
  if (
    keys.some(
      (k) =>
        k.includes('diffusion_model') ||
        k.includes('double_blocks') ||
        k.includes('cond_stage_model') ||
        k.includes('conditioner.embedders') ||
        k.includes('model.diffusion_model'),
    )
  ) {
    return 'checkpoint';
  }

  return guessFromFilename(filePath);
}

function pathBasename(p) {
  return p.split(/[/\\]/).pop() || p;
}

function guessFromFilename(filePath) {
  const name = pathBasename(filePath).toLowerCase();
  if (name.includes('lora') || name.includes('lycoris') || name.includes('locon')) return 'lora';
  if (name.includes('vae')) return 'vae';
  if (name.includes('control') || name.includes('canny') || name.includes('depth')) return 'controlnet';
  if (name.includes('upscal') || name.includes('esrgan') || name.includes('4x')) return 'upscaler';
  if (name.includes('embed') || name.includes('textual')) return 'embedding';
  if (name.endsWith('.safetensors') || name.endsWith('.ckpt') || name.endsWith('.pt')) {
    return 'checkpoint';
  }
  return 'unknown';
}

export const MODEL_TYPE_OPTIONS = [
  { value: 'checkpoint', label: 'Checkpoint' },
  { value: 'lora', label: 'LoRA' },
  { value: 'vae', label: 'VAE' },
  { value: 'upscaler', label: 'Upscaler' },
  { value: 'embedding', label: 'Embedding' },
  { value: 'controlnet', label: 'ControlNet' },
];
