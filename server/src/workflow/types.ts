/** ComfyUI API-format node. Links are `[nodeId, outputSlot]`. */
export type NodeRef = [string, number];

export type ComfyNode = {
  class_type: string;
  inputs: Record<string, unknown>;
};

export type ComfyPrompt = Record<string, ComfyNode>;

export type LoraSettings = {
  name: string;
  strength_model: number;
  strength_clip: number;
};

export type ControlNetSettings = {
  name: string;
  image: string;
  strength: number;
  start_percent?: number;
  end_percent?: number;
  preprocessor?: 'none' | 'canny' | 'depth' | 'openpose';
};

export type HiresFixSettings = {
  enabled: boolean;
  scale: number;
  steps: number;
  denoise: number;
  sampler?: string;
  scheduler?: string;
};

export type DetailerSettings = {
  enabled: boolean;
  guide_size?: number;
  steps?: number;
  denoise?: number;
  detector?: string;
};

export type UpscaleSettings = {
  enabled: boolean;
  model: string;
  scale?: number;
  refine?: boolean;
  refineDenoise?: number;
  refineSteps?: number;
};

export type OutpaintSettings = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  feather: number;
  /** When set (e.g. "16:9"), pads are computed to reach this aspect */
  targetAspect?: string | null;
};

export type GenerationMode = 'txt2img' | 'img2img' | 'outpaint' | 'edit' | 'upscale';
export type SourceSizeMode = 'match' | 'aspect';
export type SourceFitMode = 'crop' | 'fit';
export type EditStrategy = 'kontext' | 'qwen';

export type ModelLoadMode = 'checkpoint' | 'split';

export type GenerationSettings = {
  prompt: string;
  negative_prompt: string;
  /** Pre-expansion prompt when it contained wildcards (prompt holds the resolved text) */
  promptTemplate?: string;
  negativeTemplate?: string;
  /** Client prompt-box text and preset state (for Reuse); not used to build the graph */
  userPrompt?: string;
  userNegative?: string;
  familyId?: string;
  styleId?: string;
  dismissedPositive?: string[];
  dismissedNegative?: string[];
  qualityPreset?: string;
  negativePreset?: string;
  checkpoint: string;
  modelMode?: ModelLoadMode;
  unet?: string;
  clipName?: string;
  clipName2?: string;
  clipType?: string;
  vaeName?: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  batch_size: number;
  clipSkip?: number;
  guidance?: number;
  generationMode?: GenerationMode;
  /** ComfyUI input filename (or Darkroom gallery name resolved server-side) */
  sourceImage?: string;
  /** History id of the parent generation this was derived from */
  parentId?: string;
  denoise?: number;
  sourceSizeMode?: SourceSizeMode;
  sourceFit?: SourceFitMode;
  /** Pixel multiple for rounding (from family; default 64) */
  sizeMultiple?: number;
  outpaint?: OutpaintSettings | null;
  editStrategy?: EditStrategy;
  /** Optional preferred inpaint / fill model filename for outpaint families */
  inpaintModel?: string;
  loras?: LoraSettings[];
  controlnet?: ControlNetSettings | null;
  hiresFix?: HiresFixSettings | null;
  detailer?: DetailerSettings | null;
  upscale?: UpscaleSettings | null;
};

export type WorkflowModule = {
  name: string;
  shouldApply: (settings: GenerationSettings) => boolean;
  apply: (ctx: import('./graph.js').PipelineContext) => void;
};
