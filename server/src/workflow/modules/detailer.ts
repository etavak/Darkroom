import { ensureSave } from '../graph.js';
import type { WorkflowModule } from '../types.js';

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
