import type { ControlNetSettings, GenerationSettings, NodeRef, WorkflowModule } from '../types.js';
import { MAX_CONTROLNETS } from '../types.js';
import type { PipelineContext } from '../graph.js';
import { loadObjectInfo, resolveNodeClass } from '../objectInfo.js';

type Preprocessor = NonNullable<ControlNetSettings['preprocessor']>;

const PREPROCESSOR_CANDIDATES: Record<string, string[]> = {
  canny: ['CannyEdgePreprocessor', 'CannyPreprocessor', 'AIO_Preprocessor'],
  depth: [
    'DepthAnythingPreprocessor',
    'MiDaS-DepthMapPreprocessor',
    'Zoe-DepthMapPreprocessor',
    'AIO_Preprocessor',
  ],
  openpose: ['OpenposePreprocessor', 'DWPreprocessor', 'AIO_Preprocessor'],
  lineart: ['LineArtPreprocessor', 'AnimeLineArtPreprocessor', 'AIO_Preprocessor'],
  tile: ['TilePreprocessor', 'AIO_Preprocessor'],
};

/** AIO_Preprocessor picks the method from a combo */
const AIO_NAMES: Record<string, string> = {
  canny: 'CannyEdgePreprocessor',
  depth: 'DepthAnythingPreprocessor',
  openpose: 'OpenposePreprocessor',
  lineart: 'LineArtPreprocessor',
  tile: 'TilePreprocessor',
};

/** Tile works on the plain image too, so it doesn't require ControlNet Aux. */
const OPTIONAL_PREPROCESS = new Set<string>(['tile']);

/** The guides to apply, in order (the old single `controlnet` field still works). */
export function controlNetList(settings: GenerationSettings): ControlNetSettings[] {
  const list = settings.controlnets?.length ? settings.controlnets : settings.controlnet ? [settings.controlnet] : [];
  return list.filter((cn) => cn.name && cn.image).slice(0, MAX_CONTROLNETS);
}

export type PreprocessNode = { className: string; inputs: Record<string, unknown> };

/**
 * The ComfyUI node that turns a photo into a pose / depth / edge map, or null when the
 * image is used as-is. Throws when the type needs ControlNet Aux and it isn't installed.
 */
export async function resolvePreprocessor(kind: ControlNetSettings['preprocessor']): Promise<PreprocessNode | null> {
  if (!kind || kind === 'none') return null;
  const info = await loadObjectInfo();
  const className = resolveNodeClass(info, PREPROCESSOR_CANDIDATES[kind] || []);
  if (!className) {
    if (OPTIONAL_PREPROCESS.has(kind)) return null;
    throw new Error(
      `ControlNet type "${kind}" needs ControlNet Aux. Install comfyui_controlnet_aux (launcher → Components → Custom nodes), or use a ready-made map.`,
    );
  }
  return { className, inputs: className === 'AIO_Preprocessor' ? { preprocessor: AIO_NAMES[kind as Preprocessor] ?? kind } : {} };
}

/**
 * Applies the ControlNet guides to the conditioning, one after another.
 * Each `image` is a filename already in ComfyUI's input folder.
 */
export const controlnetModule: WorkflowModule = {
  name: 'controlnet',

  shouldApply(settings) {
    return controlNetList(settings).length > 0;
  },

  apply(ctx) {
    // Sync path without preprocessors — builder prefers applyControlNet when possible.
    for (const cn of controlNetList(ctx.settings)) applyOne(ctx, cn, null);
  },
};

/** Async apply with optional aux preprocessors (object_info lookup). */
export async function applyControlNet(ctx: PipelineContext): Promise<void> {
  for (const cn of controlNetList(ctx.settings)) {
    applyOne(ctx, cn, await resolvePreprocessor(cn.preprocessor));
  }
}

function applyOne(ctx: PipelineContext, cn: ControlNetSettings, preprocess: PreprocessNode | null) {
  const loader = ctx.graph.add('ControlNetLoader', {
    control_net_name: cn.name,
  });
  const image = ctx.graph.add('LoadImage', {
    image: cn.image,
  });

  let imageRef: NodeRef = [image, 0];
  if (preprocess) {
    const pre = ctx.graph.add(preprocess.className, { ...preprocess.inputs, image: imageRef });
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
