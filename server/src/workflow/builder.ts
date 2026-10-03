import { applyEditModule } from './edit/index.js';
import { baseModule, createEmptyContext } from './modules/base.js';
import { applyControlNet, controlnetModule } from './modules/controlnet.js';
import { detailerModule, prepareDetailer } from './modules/detailer.js';
import { hiresFixModule } from './modules/hiresFix.js';
import { lorasModule } from './modules/loras.js';
import { applyOutpaint } from './modules/outpaint.js';
import { upscaleModule } from './modules/upscale.js';
import type { ComfyPrompt, GenerationSettings, WorkflowModule } from './types.js';

const postSampleModules: WorkflowModule[] = [
  hiresFixModule,
  detailerModule,
  upscaleModule,
];

export async function buildWorkflow(settings: GenerationSettings): Promise<ComfyPrompt> {
  const ctx = createEmptyContext(settings);
  const mode = settings.generationMode ?? 'txt2img';

  // LoRAs patch model + clip, so they go between loading and prompt encoding.
  baseModule.loadModels(ctx);
  if (lorasModule.shouldApply(settings)) {
    lorasModule.apply(ctx);
  }
  baseModule.encodePrompts(ctx);
  baseModule.emptyLatent(ctx);
  if (controlnetModule.shouldApply(settings)) {
    await applyControlNet(ctx);
  }

  if (mode === 'edit' && settings.sourceImage) {
    const strategy = settings.editStrategy ?? 'kontext';
    await applyEditModule(ctx, strategy);
  } else if (mode === 'outpaint' && settings.sourceImage) {
    await applyOutpaint(ctx);
  } else if (mode === 'upscale' && settings.sourceImage) {
    baseModule.loadSourceImage(ctx);
  } else if (mode === 'img2img' && settings.sourceImage) {
    await baseModule.loadSourceLatent(ctx);
    baseModule.sample(ctx);
  } else {
    baseModule.sample(ctx);
  }

  // Fail with a clear message (not ComfyUI's 400) when the face detailer's parts are missing
  if (detailerModule.shouldApply(ctx.settings)) await prepareDetailer(ctx);
  for (const mod of postSampleModules) {
    if (mod.shouldApply(settings)) {
      mod.apply(ctx);
    }
  }

  return ctx.graph.toPrompt();
}

export type { GenerationSettings, ComfyPrompt } from './types.js';
export {
  baseModule,
  lorasModule,
  controlnetModule,
  hiresFixModule,
  detailerModule,
  upscaleModule,
};
