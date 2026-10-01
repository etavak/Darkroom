import { ensureSave, type PipelineContext, WorkflowGraph } from '../graph.js';
import type { WorkflowModule } from '../types.js';

/**
 * Core txt2img path (built-in ComfyUI nodes only):
 * CheckpointLoader → CLIP encode ×2 → EmptyLatent → KSampler → VAEDecode → SaveImage
 *
 * Split into load (before optional LoRA/ControlNet) and sample (after).
 */
export const baseModule: WorkflowModule & {
  load: (ctx: PipelineContext) => void;
  sample: (ctx: PipelineContext) => void;
} = {
  name: 'base',
  shouldApply: () => true,

  apply(ctx) {
    baseModule.load(ctx);
  },

  load(ctx) {
    const { graph, settings } = ctx;

    const ckpt = graph.add('CheckpointLoaderSimple', {
      ckpt_name: settings.checkpoint,
    });

    ctx.model = [ckpt, 0];
    ctx.clip = [ckpt, 1];
    ctx.vae = [ckpt, 2];

    if (typeof settings.clipSkip === 'number' && settings.clipSkip > 1) {
      // CLIPSetLastLayer uses negative index: skip 2 → -2
      const clipSkip = graph.add('CLIPSetLastLayer', {
        clip: ctx.clip,
        stop_at_clip_layer: -Math.abs(settings.clipSkip),
      });
      ctx.clip = [clipSkip, 0];
    }

    const posText = settings.prompt;
    const negText = settings.negative_prompt;

    const pos = graph.add('CLIPTextEncode', {
      text: posText,
      clip: ctx.clip,
    });
    ctx.positive = [pos, 0];

    if (typeof settings.guidance === 'number') {
      const guided = graph.add('FluxGuidance', {
        guidance: settings.guidance,
        conditioning: ctx.positive,
      });
      ctx.positive = [guided, 0];
    }

    const neg = graph.add('CLIPTextEncode', {
      text: negText,
      clip: ctx.clip,
    });
    ctx.negative = [neg, 0];

    const latent = graph.add('EmptyLatentImage', {
      width: settings.width,
      height: settings.height,
      batch_size: settings.batch_size,
    });
    ctx.latent = [latent, 0];
  },

  sample(ctx) {
    const { graph, settings } = ctx;

    const sampler = graph.add('KSampler', {
      seed: settings.seed,
      steps: settings.steps,
      cfg: settings.cfg,
      sampler_name: settings.sampler,
      scheduler: settings.scheduler,
      denoise: 1,
      model: ctx.model,
      positive: ctx.positive,
      negative: ctx.negative,
      latent_image: ctx.latent,
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

/** Create an empty pipeline shell; ports filled by base.load */
export function createEmptyContext(
  settings: import('../types.js').GenerationSettings,
): PipelineContext {
  return {
    graph: new WorkflowGraph(),
    settings,
    model: ['', 0],
    clip: ['', 0],
    vae: ['', 0],
    positive: ['', 0],
    negative: ['', 0],
    latent: ['', 0],
    image: null,
    saveNodeId: null,
  };
}
