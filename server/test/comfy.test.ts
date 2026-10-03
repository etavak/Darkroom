import { describe, expect, it } from 'vitest';
import objectInfo from './fixtures/object_info.json';
import { comboOptions } from '../src/workflow/objectInfo.js';
import { describeQueueError } from '../src/services/comfyClient.js';
import { listModelCatalog } from '../src/services/modelLists.js';
import { faceDetailerMissing, pickDetector } from '../src/workflow/modules/detailer.js';

const info = objectInfo as Record<string, unknown>;

describe('reading ComfyUI dropdowns', () => {
  it('reads the classic [[options]] format', () => {
    expect(comboOptions(info, 'KSampler', 'sampler_name')).toContain('euler');
  });
  it('reads the newer ["COMBO", {options}] format (the upscaler list bug)', () => {
    expect((info.UpscaleModelLoader as { input: { required: { model_name: unknown[] } } }).input.required.model_name[0]).toBe('COMBO');
    expect(comboOptions(info, 'UpscaleModelLoader', 'model_name').length).toBeGreaterThan(0);
  });
  it('returns [] for unknown nodes / inputs', () => {
    expect(comboOptions(info, 'Nope', 'x')).toEqual([]);
    expect(comboOptions(info, 'KSampler', 'nope')).toEqual([]);
  });
  it('the model catalog sees upscalers, samplers and the face detailer', async () => {
    const c = await listModelCatalog(true);
    expect(c.upscale_models.length).toBeGreaterThan(0);
    expect(c.samplers).toContain('euler');
    expect(c.available.faceDetailer).toBe(true);
    expect(c.detailer_detectors.every((d) => d.startsWith('bbox/'))).toBe(true);
  });
});

describe('face detailer readiness', () => {
  it('names what is missing', () => {
    expect(faceDetailerMissing({})).toBe('impact-pack');
    expect(faceDetailerMissing({ FaceDetailer: {} })).toBe('impact-subpack');
    expect(faceDetailerMissing({ FaceDetailer: {}, UltralyticsDetectorProvider: { input: { required: { model_name: [['segm/x.pt']] } } } })).toBe('face-model');
    expect(faceDetailerMissing(info)).toBe(null);
  });
  it('picks an installed face model when the saved one is gone', () => {
    expect(pickDetector(['bbox/hand_yolov8s.pt', 'bbox/face_yolov8m.pt'], 'bbox/gone.pt')).toBe('bbox/face_yolov8m.pt');
    expect(pickDetector(['bbox/x.pt'], 'bbox/x.pt')).toBe('bbox/x.pt');
    expect(pickDetector(['segm/x.pt'])).toBe(null);
  });
});

describe('ComfyUI rejections become readable', () => {
  it('missing node', () => {
    const body = JSON.stringify({ error: { type: 'missing_node_type', message: "Node 'UltralyticsDetectorProvider' not found.", extra_info: { class_type: 'UltralyticsDetectorProvider' } }, node_errors: {} });
    expect(describeQueueError(400, body)).toMatch(/doesn't have the “UltralyticsDetectorProvider” node.*restart ComfyUI/);
  });
  it('validation error names the node', () => {
    const body = JSON.stringify({ error: { type: 'prompt_outputs_failed_validation' }, node_errors: { '4': { class_type: 'CheckpointLoaderSimple', errors: [{ message: 'Value not in list', details: "ckpt_name: 'x' not in []" }] } } });
    expect(describeQueueError(400, body)).toBe("ComfyUI rejected the job: CheckpointLoaderSimple — Value not in list (ckpt_name: 'x' not in [])");
  });
  it('non-JSON body', () => {
    expect(describeQueueError(500, 'boom')).toMatch(/ComfyUI rejected the job \(500\): boom/);
  });
});
