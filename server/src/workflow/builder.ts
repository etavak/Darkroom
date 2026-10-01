import { baseModule, createEmptyContext } from './modules/base.js';
import { controlnetModule } from './modules/controlnet.js';
import { detailerModule } from './modules/detailer.js';
import { hiresFixModule } from './modules/hiresFix.js';
import { lorasModule } from './modules/loras.js';
import { upscaleModule } from './modules/upscale.js';
import type { ComfyPrompt, GenerationSettings, WorkflowModule } from './types.js';

/**
 * Module order:
 *   base.load → loras → controlnet → base.sample → hiresFix → detailer → upscale
 *
 * Each optional module rewires PipelineContext ports; SaveImage always tracks final image.
 */
const postSampleModules: WorkflowModule[] = [
  hiresFixModule,
  detailerModule,
  upscaleModule,
];

export function buildWorkflow(settings: GenerationSettings): ComfyPrompt {
  const ctx = createEmptyContext(settings);

  baseModule.load(ctx);

  if (lorasModule.shouldApply(settings)) {
    lorasModule.apply(ctx);
  }
  if (controlnetModule.shouldApply(settings)) {
    controlnetModule.apply(ctx);
  }

  baseModule.sample(ctx);

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
