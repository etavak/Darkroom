import { ensureSave, type PipelineContext } from '../graph.js';
import {
  hasNodeClass,
  loadObjectInfo,
  requireNodeClass,
  resolveNodeClass,
} from '../objectInfo.js';

/**
 * Flux Kontext-style instruction edit.
 * Class names are resolved from /object_info — never hardcoded without a check.
 */
export async function applyKontextEdit(ctx: PipelineContext): Promise<void> {
  const { graph, settings } = ctx;
  if (!settings.sourceImage) throw new Error('edit requires sourceImage');

  const objectInfo = await loadObjectInfo();
  const loadClass = requireNodeClass(objectInfo, ['LoadImage'], 'load image');
  const encodeClass = requireNodeClass(objectInfo, ['VAEEncode'], 'VAE encode');
  const decodeClass = requireNodeClass(objectInfo, ['VAEDecode'], 'VAE decode');
  const sampleClass = requireNodeClass(objectInfo, ['KSampler'], 'sampler');

  const loaded = graph.add(loadClass, { image: settings.sourceImage });
  ctx.image = [loaded, 0];

  // Prefer ReferenceLatent (official Kontext path) when present
  const refLatent = resolveNodeClass(objectInfo, ['ReferenceLatent']);
  const fluxGuidance = resolveNodeClass(objectInfo, ['FluxGuidance']);

  if (refLatent) {
    const encoded = graph.add(encodeClass, {
      pixels: ctx.image,
      vae: ctx.vae,
    });
    const referenced = graph.add(refLatent, {
      conditioning: ctx.positive,
      latent: [encoded, 0],
    });
    ctx.positive = [referenced, 0];

    if (fluxGuidance && typeof settings.guidance === 'number') {
      const guided = graph.add(fluxGuidance, {
        guidance: settings.guidance,
        conditioning: ctx.positive,
      });
      ctx.positive = [guided, 0];
    }

    // Empty latent at target size for generation guided by reference
    const emptyClass = requireNodeClass(objectInfo, ['EmptyLatentImage'], 'empty latent');
    const empty = graph.add(emptyClass, {
      width: settings.width,
      height: settings.height,
      batch_size: settings.batch_size,
    });
    ctx.latent = [empty, 0];
  } else if (hasNodeClass(objectInfo, ['InstructPix2PixConditioning'])) {
    const ip2p = requireNodeClass(
      objectInfo,
      ['InstructPix2PixConditioning'],
      'instruct edit',
    );
    const encoded = graph.add(encodeClass, {
      pixels: ctx.image,
      vae: ctx.vae,
    });
    const cond = graph.add(ip2p, {
      positive: ctx.positive,
      negative: ctx.negative,
      vae: ctx.vae,
      pixels: ctx.image,
    });
    ctx.positive = [cond, 0];
    ctx.negative = [cond, 1];
    ctx.latent = [encoded, 0];
  } else {
    // Last resort only if both dedicated edit nodes are absent: img2img encode
    const encoded = graph.add(encodeClass, {
      pixels: ctx.image,
      vae: ctx.vae,
    });
    ctx.latent = [encoded, 0];
  }

  const denoise = typeof settings.denoise === 'number' ? settings.denoise : 1;
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
