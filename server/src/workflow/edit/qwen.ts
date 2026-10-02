import { ensureSave, type PipelineContext } from '../graph.js';
import {
  hasNodeClass,
  loadObjectInfo,
  requireNodeClass,
  resolveNodeClass,
} from '../objectInfo.js';

/**
 * Qwen-Image-Edit style instruction edit.
 * Resolves node classes from /object_info (ComfyUI-QwenImage / official examples).
 */
export async function applyQwenEdit(ctx: PipelineContext): Promise<void> {
  const { graph, settings } = ctx;
  if (!settings.sourceImage) throw new Error('edit requires sourceImage');

  const objectInfo = await loadObjectInfo();
  const loadClass = requireNodeClass(objectInfo, ['LoadImage'], 'load image');
  const decodeClass = requireNodeClass(objectInfo, ['VAEDecode'], 'VAE decode');

  // Official Qwen Image Edit graphs expose one of these text-encode / edit nodes
  const textEncode = resolveNodeClass(objectInfo, [
    'TextEncodeQwenImageEdit',
    'CLIPTextEncode',
  ]);
  if (!textEncode) {
    throw new Error(
      'Missing ComfyUI node for Qwen edit text encode. Looked for: TextEncodeQwenImageEdit, CLIPTextEncode.',
    );
  }

  const sampleClass = requireNodeClass(
    objectInfo,
    ['KSampler', 'SamplerCustomAdvanced'],
    'sampler',
  );

  const loaded = graph.add(loadClass, { image: settings.sourceImage });
  ctx.image = [loaded, 0];

  // Re-encode prompt with image context when the Qwen-specific node is available
  if (textEncode === 'TextEncodeQwenImageEdit') {
    const pos = graph.add(textEncode, {
      prompt: settings.prompt,
      clip: ctx.clip,
      vae: ctx.vae,
      image: ctx.image,
    });
    ctx.positive = [pos, 0];
    const neg = graph.add(textEncode, {
      prompt: settings.negative_prompt || ' ',
      clip: ctx.clip,
      vae: ctx.vae,
      image: ctx.image,
    });
    ctx.negative = [neg, 0];
  }

  const encodeClass = requireNodeClass(objectInfo, ['VAEEncode'], 'VAE encode');
  const encoded = graph.add(encodeClass, {
    pixels: ctx.image,
    vae: ctx.vae,
  });
  ctx.latent = [encoded, 0];

  const denoise = typeof settings.denoise === 'number' ? settings.denoise : 1;
  if (sampleClass === 'KSampler') {
    const sampler = graph.add(sampleClass, {
      seed: settings.seed,
      steps: settings.steps,
      cfg: settings.cfg,
      sampler_name: settings.sampler,
      scheduler: settings.scheduler,
      denoise,
      model: ctx.model,
      positive: ctx.positive,
      negative: ctx.negative,
      latent_image: ctx.latent,
    });
    ctx.latent = [sampler, 0];
  } else {
    throw new Error(
      'SamplerCustomAdvanced edit path is not configured for this Darkroom build; install a graph that exposes KSampler.',
    );
  }

  const decoded = graph.add(decodeClass, {
    samples: ctx.latent,
    vae: ctx.vae,
  });
  ctx.image = [decoded, 0];
  ensureSave(ctx);
}

export async function canRunQwenEdit(): Promise<boolean> {
  const objectInfo = await loadObjectInfo();
  return (
    hasNodeClass(objectInfo, ['LoadImage']) &&
    hasNodeClass(objectInfo, ['TextEncodeQwenImageEdit', 'CLIPTextEncode']) &&
    hasNodeClass(objectInfo, ['VAEEncode']) &&
    hasNodeClass(objectInfo, ['KSampler'])
  );
}
