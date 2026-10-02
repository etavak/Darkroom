import { getObjectInfo } from './comfyClient.js';

export type ModelCatalog = {
  checkpoints: string[];
  diffusion_models: string[];
  text_encoders: string[];
  vae: string[];
  loras: string[];
  controlnet: string[];
  upscale_models: string[];
  embeddings: string[];
  /** DualCLIPLoader / CLIPLoader `type` combo values when available */
  clip_types: string[];
  dual_clip_types: string[];
  available: {
    checkpoint: boolean;
    unet: boolean;
    clip: boolean;
    dualClip: boolean;
    vae: boolean;
    lora: boolean;
    controlnet: boolean;
    upscale: boolean;
    /** city96 ComfyUI-GGUF nodes */
    ggufUnet: boolean;
    ggufClip: boolean;
    ggufDualClip: boolean;
  };
};

type ComboNode = {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
};

function comboList(info: Record<string, unknown>, node: string, inputKey: string): string[] {
  const n = info[node] as ComboNode | undefined;
  const required = n?.input?.required?.[inputKey];
  const optional = n?.input?.optional?.[inputKey];
  const raw = required ?? optional;
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) return [];
  return (raw[0] as unknown[]).filter((x): x is string => typeof x === 'string');
}

function hasNode(info: Record<string, unknown>, node: string): boolean {
  return Boolean(info[node]);
}

let cache: { at: number; value: ModelCatalog } | null = null;
const CACHE_MS = 15_000;

export async function listModelCatalog(force = false): Promise<ModelCatalog> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.value;
  }

  const info = await getObjectInfo();

  const textFromClip = comboList(info, 'CLIPLoader', 'clip_name');
  const textFromDual1 = comboList(info, 'DualCLIPLoader', 'clip_name1');
  const textFromDual2 = comboList(info, 'DualCLIPLoader', 'clip_name2');
  const textFromGguf = comboList(info, 'CLIPLoaderGGUF', 'clip_name');
  const textFromGgufDual1 = comboList(info, 'DualCLIPLoaderGGUF', 'clip_name1');
  const textFromGgufDual2 = comboList(info, 'DualCLIPLoaderGGUF', 'clip_name2');
  const text_encoders = uniqueSorted([
    ...textFromClip,
    ...textFromDual1,
    ...textFromDual2,
    ...textFromGguf,
    ...textFromGgufDual1,
    ...textFromGgufDual2,
  ]);

  const diffusion = uniqueSorted([
    ...comboList(info, 'UNETLoader', 'unet_name'),
    ...comboList(info, 'UnetLoaderGGUF', 'unet_name'),
  ]);

  const value: ModelCatalog = {
    checkpoints: comboList(info, 'CheckpointLoaderSimple', 'ckpt_name'),
    diffusion_models: diffusion,
    text_encoders,
    vae: comboList(info, 'VAELoader', 'vae_name'),
    loras: comboList(info, 'LoraLoader', 'lora_name'),
    controlnet: comboList(info, 'ControlNetLoader', 'control_net_name'),
    upscale_models: comboList(info, 'UpscaleModelLoader', 'model_name'),
    embeddings: comboList(info, 'EmbeddingToText', 'embedding_name'),
    clip_types: comboList(info, 'CLIPLoader', 'type'),
    dual_clip_types: comboList(info, 'DualCLIPLoader', 'type'),
    available: {
      checkpoint: hasNode(info, 'CheckpointLoaderSimple'),
      unet: hasNode(info, 'UNETLoader'),
      clip: hasNode(info, 'CLIPLoader'),
      dualClip: hasNode(info, 'DualCLIPLoader'),
      vae: hasNode(info, 'VAELoader'),
      lora: hasNode(info, 'LoraLoader'),
      controlnet: hasNode(info, 'ControlNetLoader'),
      upscale: hasNode(info, 'UpscaleModelLoader'),
      ggufUnet: hasNode(info, 'UnetLoaderGGUF'),
      ggufClip: hasNode(info, 'CLIPLoaderGGUF'),
      ggufDualClip: hasNode(info, 'DualCLIPLoaderGGUF'),
    },
  };

  cache = { at: Date.now(), value };
  return value;
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

export function invalidateModelCatalog(): void {
  cache = null;
}
