import { ensureSave } from '../graph.js';
import type { WorkflowModule } from '../types.js';

/**
 * Second-pass latent upscale + KSampler (hires fix).
 * Uses built-in LatentUpscaleBy + KSampler + VAEDecode.
 */
export const hiresFixModule: WorkflowModule = {
  name: 'hiresFix',

  shouldApply(settings) {
    return Boolean(settings.hiresFix?.enabled && (settings.hiresFix.scale ?? 0) > 1);
  },

  apply(ctx) {
    const hf = ctx.settings.hiresFix!;
    const scale = hf.scale;
    const { graph, settings } = ctx;

    const up = graph.add('LatentUpscaleBy', {
      samples: ctx.latent,
      upscale_method: 'bislerp',
      scale_by: scale,
    });

    const sampler = graph.add('KSampler', {
      seed: settings.seed + 1,
      steps: hf.steps,
      cfg: settings.cfg,
      sampler_name: hf.sampler ?? settings.sampler,
      scheduler: hf.scheduler ?? settings.scheduler,
      denoise: hf.denoise,
      model: ctx.model,
      positive: ctx.positive,
      negative: ctx.negative,
      latent_image: [up, 0],
    });
    ctx.latent = [sampler, 0];

    const decoded = graph.add('VAEDecode', {
      samples: ctx.latent,
      vae: ctx.vae,
    });
    ctx.image = [decoded, 0];
    ensureSave(ctx);
  },
};
