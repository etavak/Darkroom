import { ensureSave, type PipelineContext } from '../graph.js';
import { comboOptions, loadObjectInfo } from '../objectInfo.js';
import type { WorkflowModule } from '../types.js';

/** Ultralytics model names ComfyUI offers (e.g. "bbox/face_yolov8m.pt"). */
export function detectorModels(info: Record<string, unknown>): string[] {
  return comboOptions(info, 'UltralyticsDetectorProvider', 'model_name');
}

/** What the face detailer still needs, or null when it can run. */
export function faceDetailerMissing(info: Record<string, unknown>): 'impact-pack' | 'impact-subpack' | 'face-model' | null {
  if (!info.FaceDetailer) return 'impact-pack';
  if (!info.UltralyticsDetectorProvider) return 'impact-subpack';
  if (!detectorModels(info).some((m) => m.startsWith('bbox/'))) return 'face-model';
  return null;
}

/** The detector to use: the chosen one if installed, else an installed face model, else any bbox model. */
export function pickDetector(models: string[], wanted?: string): string | null {
  if (wanted && models.includes(wanted)) return wanted;
  const bbox = models.filter((m) => m.startsWith('bbox/'));
  return bbox.find((m) => /face_yolov8m/i.test(m)) ?? bbox.find((m) => /face/i.test(m)) ?? bbox[0] ?? null;
}

const MISSING_TEXT = {
  'impact-pack': 'The face detailer needs Impact Pack. In the launcher choose Face detailer (it installs everything), then restart ComfyUI.',
  'impact-subpack': 'The face detailer needs Impact Subpack (it finds the faces). In the launcher choose Face detailer, then restart ComfyUI.',
  'face-model': 'The face detailer has no face model yet. Install it from the Face detailer card, or the launcher’s Face detailer.',
} as const;

/** Checks the detailer can run in this ComfyUI and settles which detector model it uses. */
export async function prepareDetailer(ctx: PipelineContext): Promise<void> {
  const info = await loadObjectInfo();
  const missing = faceDetailerMissing(info);
  if (missing) throw new Error(MISSING_TEXT[missing]);
  const d = ctx.settings.detailer!;
  ctx.settings = { ...ctx.settings, detailer: { ...d, detector: pickDetector(detectorModels(info), d.detector) ?? d.detector } };
}

/**
 * Face / region detailer via Impact Pack `FaceDetailer` when enabled.
 * No-ops gracefully in the sense that it only runs when settings.detailer.enabled;
 * ComfyUI must have Impact Pack installed for the prompt to execute.
 */
export const detailerModule: WorkflowModule = {
  name: 'detailer',

  shouldApply(settings) {
    return Boolean(settings.detailer?.enabled && settings.detailer);
  },

  apply(ctx) {
    if (!ctx.image) {
      throw new Error('detailer requires a decoded image');
    }
    const d = ctx.settings.detailer!;
    const { graph, settings } = ctx;

    const bbox = graph.add('UltralyticsDetectorProvider', {
      model_name: d.detector ?? 'bbox/face_yolov8m.pt',
    });

    const detailer = graph.add('FaceDetailer', {
      image: ctx.image,
      model: ctx.model,
      clip: ctx.clip,
      vae: ctx.vae,
      positive: ctx.positive,
      negative: ctx.negative,
      bbox_detector: [bbox, 0],
      wildcard: '',
      guide_size: d.guide_size ?? 512,
      guide_size_for: true,
      max_size: 1024,
      seed: settings.seed + 2,
      steps: d.steps ?? Math.max(8, Math.floor(settings.steps / 2)),
      cfg: settings.cfg,
      sampler_name: settings.sampler,
      scheduler: settings.scheduler,
      denoise: d.denoise ?? 0.4,
      feather: 5,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: 0.5,
      bbox_dilation: 10,
      bbox_crop_factor: 3,
      sam_detection_hint: 'center-1',
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: 'False',
      drop_size: 10,
      refiner_ratio: 0.2,
      cycle: 1,
      inpaint_model: false,
      noise_mask_feather: 20,
    });

    ctx.image = [detailer, 0];
    ensureSave(ctx);
  },
};
