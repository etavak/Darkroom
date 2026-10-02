import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { buildPngMetadataTexts, injectPngText } from '../lib/pngMeta.js';
import * as comfy from './comfyClient.js';
import { loadServerSettings } from './appSettings.js';
import { supportsPerPromptPreviewMethod } from './envSettings.js';
import { buildWorkflow, type GenerationSettings } from '../workflow/index.js';
import * as history from './history.js';

export type { GenerationSettings };

export type GenerateResult = {
  jobId: string;
  promptId: string;
  clientId: string;
};

export type PreviewMethod = 'latent2rgb' | 'taesd' | 'none' | 'auto';

const pendingJobs = new Map<
  string,
  { jobId: string; clientId: string; settings: GenerationSettings }
>();

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseOptionalModules(
  b: Record<string, unknown>,
): Pick<GenerationSettings, 'loras' | 'controlnet' | 'hiresFix' | 'detailer' | 'upscale'> {
  const out: Pick<
    GenerationSettings,
    'loras' | 'controlnet' | 'hiresFix' | 'detailer' | 'upscale'
  > = {};

  if (Array.isArray(b.loras)) {
    out.loras = b.loras
      .map((item) => {
        const o = asObject(item);
        if (!o || typeof o.name !== 'string') return null;
        return {
          name: o.name,
          strength_model: typeof o.strength_model === 'number' ? o.strength_model : 1,
          strength_clip: typeof o.strength_clip === 'number' ? o.strength_clip : 1,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  const cn = asObject(b.controlnet);
  if (cn && typeof cn.name === 'string' && typeof cn.image === 'string') {
    out.controlnet = {
      name: cn.name,
      image: cn.image,
      strength: typeof cn.strength === 'number' ? cn.strength : 1,
      start_percent: typeof cn.start_percent === 'number' ? cn.start_percent : undefined,
      end_percent: typeof cn.end_percent === 'number' ? cn.end_percent : undefined,
    };
  }

  const hf = asObject(b.hiresFix);
  if (hf) {
    out.hiresFix = {
      enabled: Boolean(hf.enabled),
      scale: typeof hf.scale === 'number' ? hf.scale : 1.5,
      steps: typeof hf.steps === 'number' ? hf.steps : 15,
      denoise: typeof hf.denoise === 'number' ? hf.denoise : 0.45,
      sampler: typeof hf.sampler === 'string' ? hf.sampler : undefined,
      scheduler: typeof hf.scheduler === 'string' ? hf.scheduler : undefined,
    };
  }

  const det = asObject(b.detailer);
  if (det) {
    out.detailer = {
      enabled: Boolean(det.enabled),
      guide_size: typeof det.guide_size === 'number' ? det.guide_size : undefined,
      steps: typeof det.steps === 'number' ? det.steps : undefined,
      denoise: typeof det.denoise === 'number' ? det.denoise : undefined,
      detector: typeof det.detector === 'string' ? det.detector : undefined,
    };
  }

  const up = asObject(b.upscale);
  if (up) {
    out.upscale = {
      enabled: Boolean(up.enabled),
      model: typeof up.model === 'string' ? up.model : '',
      scale: typeof up.scale === 'number' ? up.scale : undefined,
      refine: Boolean(up.refine),
      refineDenoise: typeof up.refineDenoise === 'number' ? up.refineDenoise : undefined,
      refineSteps: typeof up.refineSteps === 'number' ? up.refineSteps : undefined,
    };
  }

  return out;
}

export function validateSettings(body: unknown): GenerationSettings {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body');
  }
  const b = body as Record<string, unknown>;

  const requireString = (key: string): string => {
    const v = b[key];
    if (typeof v !== 'string') throw new Error(`Missing or invalid ${key}`);
    return v;
  };
  const requireNumber = (key: string): number => {
    const v = b[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`Missing or invalid ${key}`);
    }
    return v;
  };

  const modelMode = b.modelMode === 'split' ? 'split' : 'checkpoint';
  const unet = typeof b.unet === 'string' ? b.unet : undefined;
  const clipName = typeof b.clipName === 'string' ? b.clipName : undefined;
  const clipName2 = typeof b.clipName2 === 'string' ? b.clipName2 : undefined;
  const clipType = typeof b.clipType === 'string' ? b.clipType : undefined;
  const vaeName = typeof b.vaeName === 'string' && b.vaeName ? b.vaeName : undefined;

  let checkpoint = typeof b.checkpoint === 'string' ? b.checkpoint : '';
  if (modelMode === 'split') {
    if (!unet) throw new Error('Missing or invalid unet');
    if (!clipName) throw new Error('Missing or invalid clipName');
    if (!vaeName) throw new Error('Missing or invalid vaeName');
    if (!checkpoint) checkpoint = unet;
  } else if (!checkpoint) {
    throw new Error('Missing or invalid checkpoint');
  }

  const generationMode =
    b.generationMode === 'img2img' ||
    b.generationMode === 'upscale' ||
    b.generationMode === 'outpaint' ||
    b.generationMode === 'edit'
      ? b.generationMode
      : 'txt2img';
  const sourceImage = typeof b.sourceImage === 'string' && b.sourceImage ? b.sourceImage : undefined;
  const denoise = typeof b.denoise === 'number' && Number.isFinite(b.denoise) ? b.denoise : undefined;
  const parentId = typeof b.parentId === 'string' && b.parentId ? b.parentId : undefined;

  if (
    (generationMode === 'img2img' ||
      generationMode === 'upscale' ||
      generationMode === 'outpaint' ||
      generationMode === 'edit') &&
    !sourceImage
  ) {
    throw new Error('Missing or invalid sourceImage');
  }

  const outRaw = asObject(b.outpaint);
  const outpaint = outRaw
    ? {
        left: typeof outRaw.left === 'number' ? outRaw.left : 0,
        right: typeof outRaw.right === 'number' ? outRaw.right : 0,
        top: typeof outRaw.top === 'number' ? outRaw.top : 0,
        bottom: typeof outRaw.bottom === 'number' ? outRaw.bottom : 0,
        feather: typeof outRaw.feather === 'number' ? outRaw.feather : 40,
        targetAspect: typeof outRaw.targetAspect === 'string' ? outRaw.targetAspect : null,
      }
    : undefined;

  return {
    prompt: typeof b.prompt === 'string' ? b.prompt : '',
    negative_prompt: typeof b.negative_prompt === 'string' ? b.negative_prompt : '',
    checkpoint,
    modelMode,
    unet,
    clipName,
    clipName2,
    clipType,
    vaeName,
    width: requireNumber('width'),
    height: requireNumber('height'),
    steps: requireNumber('steps'),
    cfg: requireNumber('cfg'),
    sampler: requireString('sampler'),
    scheduler: typeof b.scheduler === 'string' ? b.scheduler : 'normal',
    seed: requireNumber('seed'),
    batch_size: Math.max(1, Math.min(8, Math.floor(requireNumber('batch_size')))),
    clipSkip: typeof b.clipSkip === 'number' ? b.clipSkip : undefined,
    guidance: typeof b.guidance === 'number' ? b.guidance : undefined,
    generationMode,
    sourceImage,
    parentId,
    denoise,
    sourceSizeMode: b.sourceSizeMode === 'aspect' ? 'aspect' : 'match',
    sourceFit: b.sourceFit === 'fit' ? 'fit' : 'crop',
    sizeMultiple: typeof b.sizeMultiple === 'number' ? b.sizeMultiple : undefined,
    outpaint,
    editStrategy: b.editStrategy === 'qwen' ? 'qwen' : b.editStrategy === 'kontext' ? 'kontext' : undefined,
    inpaintModel: typeof b.inpaintModel === 'string' ? b.inpaintModel : undefined,
    ...parseOptionalModules(b),
  };
}

/** If sourceImage is a Darkroom gallery file, upload it into Comfy input. */
async function resolveSourceImage(settings: GenerationSettings): Promise<GenerationSettings> {
  if (!settings.sourceImage) return settings;
  const base = path.basename(settings.sourceImage);
  const localPath = path.join(config.imagesDir, base);
  if (!fs.existsSync(localPath)) {
    // Assume already a Comfy input name
    return settings;
  }
  const buf = fs.readFileSync(localPath);
  const uploaded = await comfy.uploadImage(buf, base);
  return { ...settings, sourceImage: uploaded };
}

export async function startGeneration(
  settings: GenerationSettings,
  opts?: { previewMethod?: PreviewMethod },
): Promise<GenerateResult> {
  const resolved = await resolveSourceImage(settings);
  const clientId = uuidv4();
  const workflow = await buildWorkflow(resolved);
  const previewMethod =
    opts?.previewMethod && supportsPerPromptPreviewMethod() ? opts.previewMethod : undefined;
  const queued = await comfy.queuePrompt(workflow, clientId, { previewMethod });
  const record = history.createGeneration({
    promptId: queued.prompt_id,
    clientId,
    settings: resolved,
    parentId: resolved.parentId,
  });

  pendingJobs.set(queued.prompt_id, {
    jobId: record.id,
    clientId,
    settings: resolved,
  });

  void watchAndPersist(record.id, queued.prompt_id, resolved);

  return {
    jobId: record.id,
    promptId: queued.prompt_id,
    clientId,
  };
}

type ComfyImageRef = {
  filename: string;
  subfolder?: string;
  type?: string;
};

async function watchAndPersist(
  jobId: string,
  promptId: string,
  settings: GenerationSettings,
): Promise<void> {
  const maxAttempts = 600;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(1000);
    try {
      const entry = await comfy.getHistory(promptId);
      if (!entry) continue;

      const status = entry.status as { completed?: boolean; status_str?: string } | undefined;
      if (status?.status_str === 'error') {
        history.markFailed(jobId, 'ComfyUI reported an error');
        pendingJobs.delete(promptId);
        return;
      }

      const outputs = entry.outputs as
        | Record<string, { images?: ComfyImageRef[]; parent?: unknown }>
        | undefined;
      if (!outputs) continue;

      const refs: ComfyImageRef[] = [];
      for (const nodeOut of Object.values(outputs)) {
        if (!nodeOut.images?.length) continue;
        const saved = nodeOut.images.filter((img) => !img.type || img.type === 'output');
        refs.push(...(saved.length ? saved : nodeOut.images));
      }
      if (refs.length === 0) {
        if (status?.completed) {
          history.markFailed(jobId, 'No images in ComfyUI output');
          pendingJobs.delete(promptId);
          return;
        }
        continue;
      }

      const embed = loadServerSettings().embedPngMetadata;
      const saved: string[] = [];
      for (let idx = 0; idx < refs.length; idx++) {
        const ref = refs[idx];
        let buf = await comfy.viewImage(ref);
        const ext = path.extname(ref.filename) || '.png';
        if (embed && /\.png$/i.test(ext)) {
          buf = injectPngText(buf, buildPngMetadataTexts(settings));
        }
        const localName = `${jobId}_${idx}${ext}`;
        fs.writeFileSync(path.join(config.imagesDir, localName), buf);
        saved.push(localName);
      }

      history.markCompleted(jobId, saved);
      pendingJobs.delete(promptId);
      return;
    } catch (err) {
      if (i === maxAttempts - 1) {
        history.markFailed(
          jobId,
          err instanceof Error ? err.message : 'Failed to persist generation',
        );
        pendingJobs.delete(promptId);
      }
    }
  }
  history.markFailed(jobId, 'Timed out waiting for ComfyUI');
  pendingJobs.delete(promptId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getPendingJob(promptId: string) {
  return pendingJobs.get(promptId);
}
