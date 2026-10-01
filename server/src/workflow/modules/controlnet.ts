import type { WorkflowModule } from '../types.js';

/**
 * Applies a ControlNet to the positive conditioning.
 * Expects `controlnet.image` to be a filename already in ComfyUI's input folder
 * (LoadImage). Built-in nodes.
 */
export const controlnetModule: WorkflowModule = {
  name: 'controlnet',

  shouldApply(settings) {
    return Boolean(settings.controlnet?.name && settings.controlnet?.image);
  },

  apply(ctx) {
    const cn = ctx.settings.controlnet!;
    const loader = ctx.graph.add('ControlNetLoader', {
      control_net_name: cn.name,
    });
    const image = ctx.graph.add('LoadImage', {
      image: cn.image,
    });
    const applied = ctx.graph.add('ControlNetApplyAdvanced', {
      strength: cn.strength,
      start_percent: cn.start_percent ?? 0,
      end_percent: cn.end_percent ?? 1,
      positive: ctx.positive,
      negative: ctx.negative,
      control_net: [loader, 0],
      image: [image, 0],
      vae: ctx.vae,
    });
    // Advanced returns positive + negative
    ctx.positive = [applied, 0];
    ctx.negative = [applied, 1];
  },
};
