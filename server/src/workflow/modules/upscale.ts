import { ensureSave } from '../graph.js';
import type { WorkflowModule } from '../types.js';

/**
 * Model-based image upscale (UpscaleModelLoader + ImageUpscaleWithModel).
 * Scales to width*scale × height*scale, optional low-denoise refine.
 */
export const upscaleModule: WorkflowModule = {
  name: 'upscale',

  shouldApply(settings) {
    return Boolean(settings.upscale?.enabled && settings.upscale.model);
  },

  apply(ctx) {
    if (!ctx.image) {
      throw new Error('upscale requires a decoded image');
    }
    const u = ctx.settings.upscale!;
    const { graph, settings } = ctx;
    const scale = u.scale && u.scale > 0 ? u.scale : 2;

    const model = graph.add('UpscaleModelLoader', {
      model_name: u.model,
    });
    const up = graph.add('ImageUpscaleWithModel', {
      upscale_model: [model, 0],
      image: ctx.image,
    });
    ctx.image = [up, 0];

    const targetW = Math.max(64, Math.round(settings.width * scale));
    const targetH = Math.max(64, Math.round(settings.height * scale));
    const scaled = graph.add('ImageScale', {
      image: ctx.image,
      upscale_method: 'lanczos',
      width: targetW,
      height: targetH,
      crop: 'disabled',
    });
    ctx.image = [scaled, 0];

    if (u.refine) {
      const encoded = graph.add('VAEEncode', {
        pixels: ctx.image,
        vae: ctx.vae,
      });
      const sampler = graph.add('KSampler', {
        seed: settings.seed,
        steps: u.refineSteps ?? 12,
        cfg: settings.cfg,
        sampler_name: settings.sampler,
        scheduler: settings.scheduler,
        denoise: u.refineDenoise ?? 0.25,
        model: ctx.model,
        positive: ctx.positive,
        negative: ctx.negative,
        latent_image: [encoded, 0],
      });
      const decoded = graph.add('VAEDecode', {
        samples: [sampler, 0],
        vae: ctx.vae,
      });
      ctx.image = [decoded, 0];
      ctx.latent = [sampler, 0];
    }

    ensureSave(ctx);
  },
};
