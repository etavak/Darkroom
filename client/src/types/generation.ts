export type LoraSettings = {
  name: string;
  strength_model: number;
  strength_clip: number;
  /** Studio on/off switch; off LoRAs stay listed but aren't sent */
  enabled?: boolean;
};

export type ControlNetSettings = {
  name: string;
  image: string;
  strength: number;
  start_percent?: number;
  end_percent?: number;
  /** Optional aux preprocessor (requires controlnet_aux; tile works without it). */
  preprocessor?: ControlNetPreprocessor;
};

export type ControlNetPreprocessor = 'none' | 'canny' | 'depth' | 'openpose' | 'lineart' | 'tile';

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
  targetAspect?: string | null;
};

export type ModelLoadMode = 'checkpoint' | 'split';
export type GenerationMode = 'txt2img' | 'img2img' | 'outpaint' | 'edit' | 'upscale';
export type SourceSizeMode = 'match' | 'aspect';
export type SourceFitMode = 'crop' | 'fit';
export type EditStrategy = 'kontext' | 'qwen';

/** UI mode selector (maps to generationMode). */
export type WorkMode = 'generate' | 'img2img' | 'outpaint' | 'edit';

export type GenerationSettings = {
  prompt: string;
  negative_prompt: string;
  /** Server-set: pre-expansion prompt when it contained wildcards */
  promptTemplate?: string;
  negativeTemplate?: string;
  /** Prompt-box text and preset state at generate time (prompt = preset tags + this) */
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
  sourceImage?: string;
  parentId?: string;
  denoise?: number;
  sourceSizeMode?: SourceSizeMode;
  sourceFit?: SourceFitMode;
  sizeMultiple?: number;
  outpaint?: OutpaintSettings | null;
  /** Inpaint mask (ComfyUI input name), white = redraw, at the padded size */
  maskImage?: string;
  editStrategy?: EditStrategy;
  inpaintModel?: string;
  loras?: LoraSettings[];
  /** Older records have only this; `controlnets` holds every guide (the first is also here). */
  controlnet?: ControlNetSettings | null;
  controlnets?: ControlNetSettings[];
  hiresFix?: HiresFixSettings | null;
  detailer?: DetailerSettings | null;
  upscale?: UpscaleSettings | null;
};

export type GenerationRecord = {
  id: string;
  createdAt: number;
  promptId: string;
  clientId: string;
  settings: GenerationSettings;
  images: string[];
  status: string;
  error: string | null;
  completedAt?: number | null;
  durationMs?: number | null;
  parentId?: string | null;
};

export type GenerateResponse = {
  jobId: string;
  promptId: string;
  clientId: string;
};

export type GenerationUiState = GenerationSettings & {
  seedLocked: boolean;
};

export type ModelCatalog = {
  checkpoints: string[];
  diffusion_models: string[];
  text_encoders: string[];
  vae: string[];
  loras: string[];
  controlnet: string[];
  upscale_models: string[];
  embeddings: string[];
  clip_types: string[];
  dual_clip_types: string[];
  detailer_detectors?: string[];
  samplers?: string[];
  schedulers?: string[];
  available: {
    checkpoint: boolean;
    unet: boolean;
    clip: boolean;
    dualClip: boolean;
    vae: boolean;
    lora: boolean;
    controlnet: boolean;
    upscale: boolean;
    ggufUnet?: boolean;
    ggufClip?: boolean;
    ggufDualClip?: boolean;
    faceDetailer?: boolean;
    controlnetAux?: boolean;
  };
};

export type ModelInstallJob = {
  id: string;
  status: 'resolving' | 'downloading' | 'detecting' | 'ready' | 'installing' | 'done' | 'error';
  progress: number;
  transferred: number;
  total: number;
  filename?: string;
  guessedType?: string;
  error?: string;
  dest?: string;
  modelName?: string;
  downloadUrl?: string;
  tempPath?: string;
  localPath?: string;
  allowLink?: boolean;
  defaultMode?: 'copy' | 'move' | 'link';
  linkType?: 'symlink' | 'hardlink';
  candidates?: Array<{ path: string; size: number; downloadUrl: string; filename: string }>;
  companions?: Array<{
    path: string;
    size: number;
    downloadUrl: string;
    filename: string;
    fileType: string;
    sha256?: string;
  }>;
  triggerWords?: string[];
};

export type DependencyOption = {
  id: string;
  filename: string;
  type: string;
  notes?: string;
  sizeBytes: number;
  sha256: string;
  gated: boolean;
  licenseUrl?: string;
  recommended: boolean;
};

export type DependencyRole = {
  role: string;
  required: boolean;
  status: 'satisfied' | 'missing' | 'choice';
  satisfiedBy?: { filename: string; path: string };
  options: DependencyOption[];
  preselected?: string | null;
};

export type DependencyAnalysis = {
  familyId: string;
  vramGB: number | null;
  roles: DependencyRole[];
  freeDiskBytes: number | null;
  freeDiskLabel: string;
};

export type DependencyPlan = {
  id: string;
  familyId: string;
  items: Array<{
    role: string;
    action: 'download' | 'local';
    type: string;
    filename: string;
    sizeBytes: number;
    gated: boolean;
    licenseUrl?: string;
    notes?: string;
  }>;
  totalBytes: number;
  totalLabel: string;
  freeDiskBytes: number | null;
  freeDiskLabel: string;
  gatedLicenseUrls: string[];
  needsHfToken: boolean;
  status: 'ready' | 'running' | 'done' | 'error';
  progress: number;
  currentFile?: string;
  error?: string;
  completed: string[];
};

export type SystemStatsSummary = {
  ok: boolean;
  label: string;
  deviceName: string | null;
  backend: string | null;
  vramTotal: number | null;
  vramFree: number | null;
  vramTooltip: string | null;
};

export type SourceImageState = {
  previewUrl: string;
  comfyName: string;
  localName: string;
  width: number;
  height: number;
  parentId?: string | null;
};

/** A job waiting in (or running from) the generate queue */
export type QueuedJob = {
  id: string;
  settings: GenerationSettings;
  label: string;
};

export type UpscaleRequest = {
  model: string;
  scale: number;
  refine: boolean;
};

export type VaryStrength = 'subtle' | 'strong';
