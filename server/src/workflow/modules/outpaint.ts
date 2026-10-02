import { ensureSave } from '../graph.js';
import { loadObjectInfo, requireNodeClass } from '../objectInfo.js';
import type { WorkflowModule } from '../types.js';

/**
 * Pad source image for outpainting, encode, apply noise mask, then sample.
 * Uses only class names present in /object_info.
 */
export const outpaintModule: WorkflowModule = {
  name: 'outpaint',

  shouldApply(settings) {
    return settings.generationMode === 'outpaint' && Boolean(settings.sourceImage);
  },

  apply() {
    /* Applied via applyOutpaint() in builder (async /object_info resolve). */
  },
};

export async function applyOutpaint(ctx: import('../graph.js').PipelineContext): Promise<void> {
  const { graph, settings } = ctx;
  if (!settings.sourceImage) throw new Error('outpaint requires sourceImage');

  const objectInfo = await loadObjectInfo();
  const padClass = requireNodeClass(
    objectInfo,
    ['ImagePadForOutpaint'],
    'outpaint padding',
  );
  const encodeClass = requireNodeClass(objectInfo, ['VAEEncode'], 'VAE encode');
  const maskClass = requireNodeClass(
    objectInfo,
    ['SetLatentNoiseMask'],
    'latent noise mask',
  );
  const sampleClass = requireNodeClass(objectInfo, ['KSampler'], 'sampler');
  const decodeClass = requireNodeClass(objectInfo, ['VAEDecode'], 'VAE decode');

  const op = settings.outpaint ?? {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    feather: 40,
  };

  const loaded = graph.add('LoadImage', { image: settings.sourceImage });
  const padded = graph.add(padClass, {
    image: [loaded, 0],
    left: Math.max(0, Math.floor(op.left)),
    top: Math.max(0, Math.floor(op.top)),
    right: Math.max(0, Math.floor(op.right)),
    bottom: Math.max(0, Math.floor(op.bottom)),
    feathering: Math.max(0, Math.floor(op.feather)),
  });
  // ImagePadForOutpaint → IMAGE, MASK
  ctx.image = [padded, 0];

  const encoded = graph.add(encodeClass, {
    pixels: ctx.image,
    vae: ctx.vae,
  });

  const masked = graph.add(maskClass, {
    samples: [encoded, 0],
    mask: [padded, 1],
  });
  ctx.latent = [masked, 0];

  const denoise = typeof settings.denoise === 'number' ? settings.denoise : 0.7;
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

  const decoded = graph.add(decodeClass, {
    samples: ctx.latent,
    vae: ctx.vae,
  });
  ctx.image = [decoded, 0];
  ensureSave(ctx);
}
