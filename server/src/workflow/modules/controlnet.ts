import fs from 'node:fs';
import path from 'node:path';
import { getComfyUiRoot } from '../../services/envSettings.js';
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

/** SetUnionControlNetType names for each guide type (union models cover several). */
const UNION_TYPES: Record<string, string> = {
  openpose: 'openpose',
  depth: 'depth',
  canny: 'canny/lineart/anime_lineart/mlsd',
  lineart: 'canny/lineart/anime_lineart/mlsd',
  tile: 'tile',
  none: 'auto',
};

/** SDXL union models (xinsir and similar) take a type; Flux union Pro 2.0 has no type input. */
const isTypedUnion = (name: string) => /union/i.test(name) && !/flux/i.test(name);

/** Tile works on the plain image too, so it doesn't require ControlNet Aux. */
const OPTIONAL_PREPROCESS = new Set<string>(['tile']);

function auxInstalledButNotLoaded(): boolean {
  const root = getComfyUiRoot();
  return Boolean(root && fs.existsSync(path.join(root, 'custom_nodes', 'comfyui_controlnet_aux')));
}

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
      auxInstalledButNotLoaded()
        ? `ControlNet Aux is installed but ComfyUI hasn't loaded it — restart ComfyUI (launcher → Stop everything, then Start Darkroom). If it still doesn't load, check ComfyUI's log for an import error.`
        : `ControlNet type "${kind}" needs ControlNet Aux. Install comfyui_controlnet_aux (launcher → Custom nodes or ControlNet models), or use a ready-made map.`,
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
    for (const cn of controlNetList(ctx.settings)) applyOne(ctx, cn, null, false);
  },
};

/** Async apply with optional aux preprocessors (object_info lookup). */
export async function applyControlNet(ctx: PipelineContext): Promise<void> {
  const guides = controlNetList(ctx.settings);
  const unionNode = guides.some((g) => isTypedUnion(g.name))
    ? Boolean(resolveNodeClass(await loadObjectInfo(), ['SetUnionControlNetType']))
    : false;
  for (const cn of guides) {
    applyOne(ctx, cn, await resolvePreprocessor(cn.preprocessor), unionNode);
  }
}

function applyOne(ctx: PipelineContext, cn: ControlNetSettings, preprocess: PreprocessNode | null, unionNode: boolean) {
  const loader = ctx.graph.add('ControlNetLoader', {
    control_net_name: cn.name,
  });
  let controlNet: NodeRef = [loader, 0];
  // A union model follows whichever type it's told (it would otherwise guess from the map)
  if (unionNode && isTypedUnion(cn.name)) {
    const typed = ctx.graph.add('SetUnionControlNetType', {
      control_net: controlNet,
      type: UNION_TYPES[cn.preprocessor ?? 'none'] ?? 'auto',
    });
    controlNet = [typed, 0];
  }
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
    control_net: controlNet,
    image: imageRef,
    vae: ctx.vae,
  });
  ctx.positive = [applied, 0];
  ctx.negative = [applied, 1];
}
