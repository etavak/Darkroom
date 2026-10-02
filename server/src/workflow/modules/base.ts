import { ensureSave, type PipelineContext, WorkflowGraph } from '../graph.js';
import type { WorkflowModule } from '../types.js';

function isGguf(name: string | undefined): boolean {
  return Boolean(name && /\.gguf$/i.test(name));
}

/**
 * Core txt2img path:
 * CheckpointLoader OR UNET+CLIP+VAE (GGUF variants when needed)
 * → CLIP encode ×2 → EmptyLatent → KSampler → VAEDecode → SaveImage
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
    const mode = settings.modelMode === 'split' ? 'split' : 'checkpoint';

    if (mode === 'split') {
      if (!settings.unet) throw new Error('Split stack requires a diffusion / UNET model');
      if (!settings.clipName) throw new Error('Split stack requires a text encoder');
      if (!settings.vaeName) throw new Error('Split stack requires a VAE');

      const unetGguf = isGguf(settings.unet);
      if (unetGguf) {
        // city96/ComfyUI-GGUF NODE_CLASS_MAPPINGS: UnetLoaderGGUF
        const unet = graph.add('UnetLoaderGGUF', { unet_name: settings.unet });
        ctx.model = [unet, 0];
      } else {
        const unetInputs: Record<string, unknown> = { unet_name: settings.unet };
        unetInputs.weight_dtype = 'default';
        const unet = graph.add('UNETLoader', unetInputs);
        ctx.model = [unet, 0];
      }

      const clip1Gguf = isGguf(settings.clipName);
      const clip2Gguf = isGguf(settings.clipName2);
      const anyClipGguf = clip1Gguf || clip2Gguf;

      if (settings.clipName2) {
        // DualCLIPLoaderGGUF accepts mixed GGUF + safetensors
        const dualClass = anyClipGguf ? 'DualCLIPLoaderGGUF' : 'DualCLIPLoader';
        const dual = graph.add(dualClass, {
          clip_name1: settings.clipName,
          clip_name2: settings.clipName2,
          type: settings.clipType || 'flux',
        });
        ctx.clip = [dual, 0];
      } else {
        const clipClass = clip1Gguf ? 'CLIPLoaderGGUF' : 'CLIPLoader';
        const clipInputs: Record<string, unknown> = {
          clip_name: settings.clipName,
        };
        if (settings.clipType) clipInputs.type = settings.clipType;
        const clip = graph.add(clipClass, clipInputs);
        ctx.clip = [clip, 0];
      }

      const vae = graph.add('VAELoader', { vae_name: settings.vaeName });
      ctx.vae = [vae, 0];
    } else {
      const ckpt = graph.add('CheckpointLoaderSimple', {
        ckpt_name: settings.checkpoint,
      });

      ctx.model = [ckpt, 0];
      ctx.clip = [ckpt, 1];
      ctx.vae = [ckpt, 2];

      if (settings.vaeName) {
        const vae = graph.add('VAELoader', { vae_name: settings.vaeName });
        ctx.vae = [vae, 0];
      }
    }

    if (typeof settings.clipSkip === 'number' && settings.clipSkip > 1) {
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
