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
 * @returns {'checkpoint' | 'diffusion' | 'text_encoder' | 'lora' | 'vae' | 'upscaler' | 'embedding' | 'controlnet' | 'unknown'}
 */
export function guessModelType(filePath) {
  const lower = filePath.toLowerCase();
  const base = lower.replace(/\\/g, '/');

  // GGUF: no safetensors header — classify by name / path
  if (lower.endsWith('.gguf')) {
    return guessGgufType(filePath);
  }

  // Path hints from HF / Comfy layouts (folder wins over ambiguous filenames)
  if (/\/(text_encoders?|clip|text_encoder)\//.test(base)) return 'text_encoder';
  if (/\/(diffusion_models?|unet|transformer)\//.test(base)) return 'diffusion';
  if (/\/vae\//.test(base)) return 'vae';

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
  const hasTextEncoder = keys.some(
    (k) =>
      k.includes('text_model') ||
      k.includes('encoder.layers') ||
      k.includes('shared.weight') ||
      k.includes('token_embedding') ||
      k.includes('text_projection'),
  );
  const hasDiffusion = keys.some(
    (k) =>
      k.includes('diffusion_model') ||
      k.includes('double_blocks') ||
      k.includes('single_blocks') ||
      k.includes('joint_blocks') ||
      k.includes('model.diffusion_model'),
  );
  const hasCond = keys.some(
    (k) => k.includes('cond_stage_model') || k.includes('conditioner.embedders'),
  );

  // Full checkpoint: diffusion + text / conditioner in one file
  if (hasDiffusion && (hasCond || hasTextEncoder)) return 'checkpoint';
  if (hasDiffusion && !hasTextEncoder) return 'diffusion';
  if (hasTextEncoder && !hasDiffusion) return 'text_encoder';
  if (hasDiffusion || hasCond) return 'checkpoint';

  return guessFromFilename(filePath);
}

function pathBasename(p) {
  return p.split(/[/\\]/).pop() || p;
}

/**
 * GGUF files are typically diffusion (UNET) or text-encoder (T5/CLIP) quants.
 * @param {string} filePath
 */
function guessGgufType(filePath) {
  const name = pathBasename(filePath).toLowerCase();
  const base = filePath.toLowerCase().replace(/\\/g, '/');
  if (/\/(text_encoders?|clip)\//.test(base)) return 'text_encoder';
  if (/\/(diffusion_models?|unet)\//.test(base)) return 'diffusion';
  if (
    name.includes('t5') ||
    name.includes('clip_l') ||
    name.includes('clip-l') ||
    name.includes('clip_g') ||
    name.includes('text_encoder') ||
    name.includes('vit-') ||
    name.includes('umt5')
  ) {
    return 'text_encoder';
  }
  // Default GGUF → diffusion (flux/sd3 transformer quants)
  return 'diffusion';
}

function guessFromFilename(filePath) {
  const name = pathBasename(filePath).toLowerCase();
  if (name.endsWith('.gguf')) return guessGgufType(filePath);
  if (name.includes('lora') || name.includes('lycoris') || name.includes('locon')) return 'lora';
  if (name.includes('vae') || name === 'ae.safetensors') return 'vae';
  if (name.includes('control') || name.includes('canny') || name.includes('depth')) return 'controlnet';
  if (name.includes('upscal') || name.includes('esrgan') || name.includes('4x')) return 'upscaler';
  if (name.includes('embed') || name.includes('textual')) return 'embedding';
  if (
    name.includes('text_encoder') ||
    name.includes('clip_l') ||
    name.includes('clip_g') ||
    name.includes('t5xxl') ||
    name.includes('mistral')
  ) {
    return 'text_encoder';
  }
  if (
    name.includes('diffusion') ||
    name.includes('unet') ||
    /^flux\d/i.test(name) ||
    name.includes('flux1') ||
    name.includes('flux-') ||
    name.includes('flux_')
  ) {
    return 'diffusion';
  }
  if (name.endsWith('.safetensors') || name.endsWith('.ckpt') || name.endsWith('.pt')) {
    return 'checkpoint';
  }
  return 'unknown';
}

export const MODEL_TYPE_OPTIONS = [
  { value: 'checkpoint', label: 'Checkpoint' },
  { value: 'diffusion', label: 'Diffusion model' },
  { value: 'text_encoder', label: 'Text encoder' },
  { value: 'lora', label: 'LoRA' },
  { value: 'vae', label: 'VAE' },
  { value: 'upscaler', label: 'Upscaler' },
  { value: 'embedding', label: 'Embedding' },
  { value: 'controlnet', label: 'ControlNet' },
];
