import { ensureSave } from '../graph.js';
import type { WorkflowModule } from '../types.js';

/**
 * Model-based image upscale (UpscaleModelLoader + ImageUpscaleWithModel).
 * Optional ImageScale if scale != 1 after the model pass.
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
    const { graph } = ctx;

    const model = graph.add('UpscaleModelLoader', {
      model_name: u.model,
    });
    const up = graph.add('ImageUpscaleWithModel', {
      upscale_model: [model, 0],
      image: ctx.image,
    });
    ctx.image = [up, 0];

    if (u.scale && u.scale !== 1) {
      const scaled = graph.add('ImageScaleBy', {
        image: ctx.image,
        upscale_method: 'lanczos',
        scale_by: u.scale,
      });
      ctx.image = [scaled, 0];
    }

    ensureSave(ctx);
  },
};
