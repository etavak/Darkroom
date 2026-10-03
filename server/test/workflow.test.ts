import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWorkflow, type GenerationSettings } from '../src/workflow/index.js';
import { validatePrompt } from './validatePrompt';

type Family = {
  id: string;
  loaderKind?: string;
  defaultClipType?: string;
  requiredComponents?: { text_encoders?: string[] };
  settings?: { cfg?: number; sampler?: string; scheduler?: string; guidance?: number };
  supportsEdit?: boolean;
  editStrategy?: string;
};

const familiesDir = path.resolve(__dirname, '../presets/families');
const families: Family[] = fs
  .readdirSync(familiesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(familiesDir, f), 'utf8')));

/** Settings the app would send for a family (split stack or checkpoint). */
function settingsFor(fam: Family, extra: Partial<GenerationSettings> = {}): GenerationSettings {
  const base = {
    prompt: 'a cat on a windowsill',
    negative_prompt: 'blurry',
    width: 1024,
    height: 1024,
    steps: 20,
    cfg: fam.settings?.cfg ?? 5,
    sampler: fam.settings?.sampler ?? 'euler',
    scheduler: fam.settings?.scheduler ?? 'normal',
    seed: 42,
    batch_size: 1,
    familyId: fam.id,
  };
  const stack =
    fam.loaderKind === 'transformer'
      ? {
          modelMode: 'split',
          unet: 'model-a.safetensors',
          clipName: 'model-a.safetensors',
          clipName2: (fam.requiredComponents?.text_encoders?.length ?? 0) > 1 ? 'model-b.safetensors' : undefined,
          clipType: fam.defaultClipType,
          vaeName: 'model-a.safetensors',
          guidance: fam.settings?.guidance,
        }
      : { modelMode: 'checkpoint', checkpoint: 'model-a.safetensors' };
  return { ...base, ...stack, ...extra } as unknown as GenerationSettings;
}

async function build(s: GenerationSettings) {
  const wf = (await buildWorkflow(s)) as unknown as { prompt?: Record<string, never> } & Record<string, never>;
  return (wf.prompt ?? wf) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
}

const classes = (p: Awaited<ReturnType<typeof build>>) => Object.values(p).map((n) => n.class_type);

describe('every family builds a valid text-to-image workflow', () => {
  it.each(families.map((f) => [f.id, f] as const))('%s', async (_id, fam) => {
    const prompt = await build(settingsFor(fam));
    expect(validatePrompt(prompt)).toEqual([]);
    expect(classes(prompt)).toContain('KSampler');
    expect(classes(prompt)).toContain('SaveImage');
  });
});

describe('features stay valid on the families they apply to', () => {
  const sdxl = families.find((f) => f.id === 'illustrious')!;
  const flux = families.find((f) => f.id === 'flux')!;

  it('LoRAs chain between the loaders and the prompt encoders', async () => {
    const p = await build(settingsFor(sdxl, { loras: [{ name: 'model-a.safetensors', strength_model: 0.8, strength_clip: 0.8 }, { name: 'model-b.safetensors', strength_model: 1, strength_clip: 1 }] }));
    expect(validatePrompt(p)).toEqual([]);
    expect(classes(p).filter((c) => c === 'LoraLoader')).toHaveLength(2);
  });

  it('hires fix adds a second pass', async () => {
    const p = await build(settingsFor(sdxl, { hiresFix: { enabled: true, scale: 1.5, steps: 12, denoise: 0.45 } }));
    expect(validatePrompt(p)).toEqual([]);
    expect(classes(p).filter((c) => c === 'KSampler')).toHaveLength(2);
  });

  it('image to image encodes the source', async () => {
    const p = await build(settingsFor(sdxl, { generationMode: 'img2img', sourceImage: 'model-a.png', denoise: 0.5 }));
    expect(validatePrompt(p)).toEqual([]);
    expect(classes(p)).toEqual(expect.arrayContaining(['LoadImage', 'VAEEncode']));
  });

  it('inpaint + extend merges the mask and pastes back the untouched pixels', async () => {
    const p = await build(
      settingsFor(sdxl, { generationMode: 'outpaint', sourceImage: 'model-a.png', maskImage: 'model-b.png', outpaint: { left: 128, right: 0, top: 64, bottom: 0, feathering: 24 } as never }),
    );
    expect(validatePrompt(p)).toEqual([]);
    expect(classes(p)).toEqual(expect.arrayContaining(['ImagePadForOutpaint', 'LoadImageMask', 'MaskComposite', 'ImageCompositeMasked']));
  });

  it('upscale (and enhance) use the upscale model — read from the newer COMBO format', async () => {
    for (const refine of [false, true]) {
      const p = await build(settingsFor(sdxl, { generationMode: 'upscale', sourceImage: 'model-a.png', upscale: { enabled: true, model: 'model-a.pth', scale: 1.5, refine } }));
      expect(validatePrompt(p)).toEqual([]);
      expect(classes(p)).toEqual(expect.arrayContaining(['UpscaleModelLoader', 'ImageUpscaleWithModel']));
    }
  });

  it('up to three ControlNet guides chain, union models get their type', async () => {
    const p = await build(
      settingsFor(sdxl, {
        controlnets: [
          { name: 'xinsir-controlnet-union-sdxl-promax.safetensors', image: 'model-a.png', strength: 1, preprocessor: 'openpose' },
          { name: 'model-a.safetensors', image: 'model-b.png', strength: 0.6, start_percent: 0.1, end_percent: 0.8, preprocessor: 'depth' },
          { name: 'model-b.safetensors', image: 'model-a.png', strength: 0.4, preprocessor: 'none' },
        ],
      }),
    );
    expect(validatePrompt(p)).toEqual([]);
    expect(classes(p).filter((c) => c === 'ControlNetApplyAdvanced')).toHaveLength(3);
    expect(Object.values(p).find((n) => n.class_type === 'SetUnionControlNetType')?.inputs.type).toBe('openpose');
  });

  it('the older single controlnet field still works', async () => {
    const p = await build(settingsFor(sdxl, { controlnet: { name: 'model-a.safetensors', image: 'model-a.png', strength: 0.7 } }));
    expect(validatePrompt(p)).toEqual([]);
    expect(classes(p)).toContain('ControlNetApplyAdvanced');
  });

  it('the face detailer finds an installed face model', async () => {
    const p = await build(settingsFor(sdxl, { detailer: { enabled: true, guide_size: 512, steps: 12, denoise: 0.4, detector: 'bbox/gone.pt' } }));
    expect(validatePrompt(p)).toEqual([]);
    const det = Object.values(p).find((n) => n.class_type === 'UltralyticsDetectorProvider');
    expect(det?.inputs.model_name).toMatch(/^bbox\//);
  });

  it('Flux uses its guidance node', async () => {
    const p = await build(settingsFor(flux));
    expect(validatePrompt(p)).toEqual([]);
    expect(classes(p)).toContain('FluxGuidance');
  });

  it('NoobAI v-pred adds its sampling patch', async () => {
    const p = await build(settingsFor(families.find((f) => f.id === 'noobai-vpred')!));
    expect(validatePrompt(p)).toEqual([]);
    expect(classes(p)).toContain('ModelSamplingDiscrete');
  });

  it('Anima matches its official workflow', async () => {
    const p = await build(settingsFor(families.find((f) => f.id === 'anima')!));
    expect(validatePrompt(p)).toEqual([]);
    expect(Object.values(p).find((n) => n.class_type === 'CLIPLoader')?.inputs.type).toBe('stable_diffusion');
    expect(classes(p)).toEqual(expect.arrayContaining(['UNETLoader', 'VAELoader', 'EmptyLatentImage', 'KSampler']));
  });

  it.each(families.filter((f) => f.supportsEdit).map((f) => [f.id, f] as const))('%s edit mode builds', async (_id, fam) => {
    const p = await build(settingsFor(fam, { generationMode: 'edit', sourceImage: 'model-a.png', editStrategy: fam.editStrategy as never }));
    expect(validatePrompt(p)).toEqual([]);
  });
});

describe('the validator itself', () => {
  it('catches unknown nodes, missing inputs and wrong link types', () => {
    const problems = validatePrompt({
      '1': { class_type: 'NotANode', inputs: {} },
      '2': { class_type: 'VAEDecode', inputs: { samples: ['3', 0] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'x', clip: ['9', 0] } },
      '4': { class_type: 'KSampler', inputs: { sampler_name: 'not-a-sampler' } },
    });
    expect(problems.join('\n')).toMatch(/NotANode: not a ComfyUI node/);
    expect(problems.join('\n')).toMatch(/VAEDecode: missing required input "vae"/);
    expect(problems.join('\n')).toMatch(/expects LATENT, got CONDITIONING/);
    expect(problems.join('\n')).toMatch(/links to missing node #9/);
    expect(problems.join('\n')).toMatch(/not-a-sampler/);
  });
});
