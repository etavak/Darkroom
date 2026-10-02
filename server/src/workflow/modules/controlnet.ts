import type { NodeRef, WorkflowModule } from '../types.js';
import type { PipelineContext } from '../graph.js';
import { loadObjectInfo, resolveNodeClass } from '../objectInfo.js';

const PREPROCESSOR_CANDIDATES: Record<string, string[]> = {
  canny: ['CannyEdgePreprocessor', 'CannyPreprocessor', 'AIO_Preprocessor'],
  depth: [
    'DepthAnythingPreprocessor',
    'MiDaS-DepthMapPreprocessor',
    'Zoe-DepthMapPreprocessor',
    'AIO_Preprocessor',
  ],
  openpose: ['OpenposePreprocessor', 'DWPreprocessor', 'AIO_Preprocessor'],
};

/**
 * Applies a ControlNet to the positive conditioning.
 * Expects `controlnet.image` to be a filename already in ComfyUI's input folder.
 */
export const controlnetModule: WorkflowModule = {
  name: 'controlnet',

  shouldApply(settings) {
    return Boolean(settings.controlnet?.name && settings.controlnet?.image);
  },

  apply(ctx) {
    // Sync path without preprocessor — builder prefers applyControlNet when possible.
    applyControlNetSync(ctx, null);
  },
};

/**
 * Async ControlNet apply with optional aux preprocessor (object_info lookup).
 */
export async function applyControlNet(ctx: PipelineContext): Promise<void> {
  const cn = ctx.settings.controlnet;
  if (!cn?.name || !cn.image) return;

  const preprocessor = cn.preprocessor && cn.preprocessor !== 'none' ? cn.preprocessor : null;
  let preprocessClass: string | null = null;
  if (preprocessor) {
    const info = await loadObjectInfo();
    const candidates = PREPROCESSOR_CANDIDATES[preprocessor] || [];
    preprocessClass = resolveNodeClass(info, candidates);
    if (!preprocessClass) {
      throw new Error(
        `ControlNet preprocessor "${preprocessor}" needs ControlNet Aux. ` +
          `Install comfyui_controlnet_aux, or set preprocessor to none.`,
      );
    }
  }
  applyControlNetSync(ctx, preprocessClass ? { className: preprocessClass, kind: preprocessor! } : null);
}

/**
 * @param preprocess null = raw image; otherwise run named preprocessor class
 */
function applyControlNetSync(
  ctx: PipelineContext,
  preprocess: { className: string; kind: string } | null,
) {
  const cn = ctx.settings.controlnet!;
  const loader = ctx.graph.add('ControlNetLoader', {
    control_net_name: cn.name,
  });
  const image = ctx.graph.add('LoadImage', {
    image: cn.image,
  });

  /** @type {NodeRef} */
  let imageRef: NodeRef = [image, 0];
  if (preprocess) {
    const inputs: Record<string, unknown> = {
      image: imageRef,
    };
    // AIO_Preprocessor uses `preprocessor` combo; dedicated nodes usually only need image.
    if (preprocess.className === 'AIO_Preprocessor') {
      const aioMap: Record<string, string> = {
        canny: 'CannyEdgePreprocessor',
        depth: 'DepthAnythingPreprocessor',
        openpose: 'OpenposePreprocessor',
      };
      inputs.preprocessor = aioMap[preprocess.kind] || preprocess.kind;
    }
    const pre = ctx.graph.add(preprocess.className, inputs);
    imageRef = [pre, 0];
  }

  const applied = ctx.graph.add('ControlNetApplyAdvanced', {
    strength: cn.strength,
    start_percent: cn.start_percent ?? 0,
    end_percent: cn.end_percent ?? 1,
    positive: ctx.positive,
    negative: ctx.negative,
    control_net: [loader, 0],
    image: imageRef,
    vae: ctx.vae,
  });
  ctx.positive = [applied, 0];
  ctx.negative = [applied, 1];
}
