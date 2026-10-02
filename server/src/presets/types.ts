/** Layer chip labels shown in the UI */
export type TagSource = 'FAMILY' | 'STYLE' | 'CKPT';

export type LayerSettings = {
  cfg?: number;
  steps?: number;
  clipSkip?: number;
  sampler?: string;
  scheduler?: string;
  guidance?: number;
  baseRes?: number;
};

/** How the UI token counter behaves for this family. */
export type PromptTokenMode = 'clip' | 'encoder';

export type TagLayer = {
  positive?: string[];
  negative?: string[];
  removePositive?: string[];
  removeNegative?: string[];
  settings?: LayerSettings;
};

export type StyleDef = TagLayer & {
  name: string;
};

/** Slots a split-stack family needs beyond the diffusion model */
export type FamilyRequiredComponents = {
  text_encoders?: string[];
  vae?: string[];
};

/** Downloadable companion roles resolved after install */
export type FamilyDependency = {
  role: string;
  required: boolean;
  options: string[];
  recommend?: { vramUnderGB?: number; pick: string };
};

export type FamilyDef = TagLayer & {
  id: string;
  name: string;
  defaultStyle: string;
  /** When true, negatives are unused (e.g. Flux) */
  disableNegative?: boolean;
  /** Tag dictionary sources under server/tags/ (empty = autocomplete disabled) */
  tagSources?: string[];
  /** How autocomplete inserts tags */
  tagFormat?: 'spaces' | 'underscores';
  /** Allow .gguf diffusion / TE (transformer families only) */
  supportsGguf?: boolean;
  /** checkpoint = single-file families; transformer = split UNET/CLIP/VAE */
  loaderKind?: 'checkpoint' | 'transformer';
  /** Required TE/VAE slots for split stack (empty for checkpoint families) */
  requiredComponents?: FamilyRequiredComponents;
  /** Filename substring hints keyed by component slot (clip_l, t5xxl, ae, …) */
  filenameHints?: Record<string, string[]>;
  /** Auto-install companions (see server/presets/components.json) */
  dependencies?: FamilyDependency[];
  /** Preferred CLIPLoader / DualCLIPLoader `type` for split stack */
  defaultClipType?: string;
  /** clip = "N preset + M / 75"; encoder = plain count vs promptMaxTokens */
  promptTokenMode?: PromptTokenMode;
  /** Max tokens for encoder families (T5 / LLM). CLIP mode uses 75. */
  promptMaxTokens?: number;
  /** Latent / pixel size multiple (8 for SD1.5, 64 for SDXL/Flux) */
  sizeMultiple?: number;
  /** Instruction-based Edit mode (Kontext / Qwen Image Edit, …) */
  supportsEdit?: boolean;
  /** Which edit graph strategy to use when supportsEdit */
  editStrategy?: 'kontext' | 'qwen';
  /** Preferred inpaint / fill model filename hint for outpaint */
  preferredInpaintModel?: string;
  styles: Record<string, StyleDef>;
};

export type CheckpointMapping = TagLayer & {
  family: string;
};

export type CheckpointsFile = {
  mappings: Record<string, CheckpointMapping>;
};

export type InjectedTag = {
  tag: string;
  from: TagSource;
};

export type ResolvedPresets = {
  familyId: string | null;
  familyName: string | null;
  styleId: string | null;
  mapped: boolean;
  disableNegative: boolean;
  positiveTags: InjectedTag[];
  negativeTags: InjectedTag[];
  finalPositive: string;
  finalNegative: string;
  settings: LayerSettings;
  aspectPresets: Array<{ id: string; label: string; width: number; height: number }>;
  tagSources: string[];
  tagFormat: 'spaces' | 'underscores';
  tagsEnabled: boolean;
};

export type ResolveInput = {
  checkpoint: string;
  styleId: string | null;
  dismissedPositive: string[];
  dismissedNegative: string[];
  userPositive: string;
  userNegative: string;
};
