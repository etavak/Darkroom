import { ensureSave } from '../graph.js';
import { loadObjectInfo, requireNodeClass } from '../objectInfo.js';

/**
 * Inpaint and/or extend: pad the source (outpaint), merge the padding mask with an optional
 * painted mask, encode, apply the noise mask, then sample.
 * Uses only class names present in /object_info.
 */
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

  // Painted mask (white = redraw) at the padded size, added to the padding's own mask
  let mask: [string, number] = [padded, 1];
  if (settings.maskImage) {
    const loadMaskClass = requireNodeClass(objectInfo, ['LoadImageMask'], 'mask loader');
    const compositeClass = requireNodeClass(objectInfo, ['MaskComposite'], 'mask merge');
    const painted = graph.add(loadMaskClass, { image: settings.maskImage, channel: 'red' });
    const merged = graph.add(compositeClass, {
      destination: [padded, 1],
      source: [painted, 0],
      x: 0,
      y: 0,
      operation: 'add',
    });
    mask = [merged, 0];
  }

  const masked = graph.add(maskClass, {
    samples: [encoded, 0],
    mask,
  });
  ctx.latent = [masked, 0];

  // Differential diffusion reads the soft mask edge as a gradual redraw strength, so the new
  // area fades into the original instead of meeting it at a hard line
  let model = ctx.model;
  if (objectInfo.DifferentialDiffusion) {
    model = [graph.add('DifferentialDiffusion', { model: ctx.model }), 0];
  }

  const denoise = typeof settings.denoise === 'number' ? settings.denoise : 0.7;
  const sampler = graph.add(sampleClass, {
    seed: settings.seed,
    steps: settings.steps,
    cfg: settings.cfg,
    sampler_name: settings.sampler,
    scheduler: settings.scheduler,
    denoise,
    model,
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

  // Paste the result over the (padded) original through the soft mask: untouched areas keep
  // their exact pixels (no VAE colour drift), and the edge blends instead of showing a seam
  if (objectInfo.ImageCompositeMasked) {
    const composite = graph.add('ImageCompositeMasked', {
      destination: [padded, 0],
      source: [decoded, 0],
      x: 0,
      y: 0,
      resize_source: false,
      mask,
    });
    ctx.image = [composite, 0];
  }
  ensureSave(ctx);
}
