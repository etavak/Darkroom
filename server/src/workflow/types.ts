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
  image: string; // filename already uploaded to Comfy input, or data ref
  strength: number;
  start_percent?: number;
  end_percent?: number;
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
  /** Impact Pack detector model filename, if present */
  detector?: string;
};

export type UpscaleSettings = {
  enabled: boolean;
  model: string;
  /** Optional secondary scale after model upscale (1 = none) */
  scale?: number;
};

export type GenerationSettings = {
  prompt: string;
  negative_prompt: string;
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  batch_size: number;
  /** CLIP skip (ComfyUI CLIPSetLastLayer stop_at_clip_layer, typically -2 for skip 2) */
  clipSkip?: number;
  /** Flux-style guidance (FluxGuidance node when set) */
  guidance?: number;
  /** Optional modules — omitted/empty means skip */
  loras?: LoraSettings[];
  controlnet?: ControlNetSettings | null;
  hiresFix?: HiresFixSettings | null;
  detailer?: DetailerSettings | null;
  upscale?: UpscaleSettings | null;
};

export type WorkflowModule = {
  name: string;
  /** Return true if this module should run for the current settings */
  shouldApply: (settings: GenerationSettings) => boolean;
  apply: (ctx: import('./graph.js').PipelineContext) => void;
};
