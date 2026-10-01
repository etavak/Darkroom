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
  clipSkip?: number;
  guidance?: number;
  loras?: LoraSettings[];
  controlnet?: ControlNetSettings | null;
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
};

export type GenerateResponse = {
  jobId: string;
  promptId: string;
  clientId: string;
};

export type GenerationUiState = GenerationSettings & {
  seedLocked: boolean;
};
