import { describe, expect, it } from 'vitest';
import { loraFit, promptHasTag, togglePromptTag } from '@/lib/loraFit';
import { apiKeyProblem, type LoraMeta } from '@/lib/api';
import { controlNetFields, controlNetsFromSettings, DEFAULT_CONTROLNET_UI } from '@/lib/generationDefaults';
import { appendOlderPage, mergeNewestPage } from '@/lib/historyPages';
import { derivedKind, derivedTag } from '@/components/studio/plane/layout';
import type { GenerationRecord, GenerationSettings } from '@/types/generation';

const meta = (m: Partial<LoraMeta>): LoraMeta => ({ name: 'x', title: null, base: null, family: null, arch: null, triggers: [], thumb: false, ...m });

describe('LoRA fit', () => {
  it('wrong architecture won\'t work; other family on the same one may not suit', () => {
    expect(loraFit(meta({ arch: 'sd15', base: 'SD 1.5' }), 'illustrious', 'Illustrious').kind).toBe('wrong-arch');
    expect(loraFit(meta({ arch: 'sdxl', family: 'pony', base: 'Pony' }), 'illustrious', 'Illustrious').kind).toBe('other-base');
    expect(loraFit(meta({ arch: 'sdxl', family: 'noobai' }), 'illustrious', 'Illustrious').kind).toBe('ok');
    expect(loraFit(meta({ arch: 'anima', family: 'anima', base: 'Anima' }), 'illustrious', 'Illustrious').kind).toBe('wrong-arch');
    expect(loraFit(meta({ arch: 'anima', family: 'anima' }), 'anima', 'Anima').kind).toBe('ok');
    expect(loraFit(undefined, 'illustrious', 'Illustrious').kind).toBe('unknown');
  });
  it('trigger words toggle in the prompt', () => {
    expect(togglePromptTag('1girl, smile', 'neon glow')).toBe('1girl, smile, neon glow');
    expect(togglePromptTag('1girl, Neon Glow, smile', 'neon glow')).toBe('1girl, smile');
    expect(togglePromptTag('', 'x')).toBe('x');
    expect(promptHasTag('a,  neon glow ', 'neon glow')).toBe(true);
  });
});

describe('download keys', () => {
  it('links and spaces aren\'t keys', () => {
    expect(apiKeyProblem('https://civitai.com/models/1')).toMatch(/link/);
    expect(apiKeyProblem('has spaces in it here')).toMatch(/letters and numbers/);
    expect(apiKeyProblem('0123456789abcdef0123456789abcdef')).toBe(null);
  });
});

describe('ControlNet guides', () => {
  const g = (o: Partial<typeof DEFAULT_CONTROLNET_UI>) => ({ ...DEFAULT_CONTROLNET_UI, enabled: true, name: 'cn.safetensors', image: 'g.png', ...o });
  it('sends complete guides only, up to three, plus the older single field', () => {
    const f = controlNetFields([g({ preprocessor: 'openpose' }), g({ image: '' }), g({}), g({}), g({})]);
    expect(f.controlnets).toHaveLength(3);
    expect(f.controlnet).toEqual(f.controlnets![0]);
    expect(controlNetFields([])).toEqual({});
  });
  it('restores from new and old saved settings', () => {
    expect(controlNetsFromSettings({ controlnet: { name: 'a', image: 'b.png', strength: 0.5 } })).toHaveLength(1);
    expect(controlNetsFromSettings({ controlnets: [{ name: 'a', image: 'b.png', preprocessor: 'tile' }] })[0].preprocessor).toBe('tile');
  });
});

describe('history pages', () => {
  const r = (id: string, at: number) => ({ id, createdAt: at }) as GenerationRecord;
  it('a fresh newest page keeps older pages already loaded', () => {
    const prev = [r('e', 5), r('d', 4), r('c', 3), r('b', 2), r('a', 1)];
    const merged = mergeNewestPage(prev, { items: [r('f', 6), r('e', 5)], hasMore: true });
    expect(merged.items.map((i) => i.id)).toEqual(['f', 'e', 'd', 'c', 'b', 'a']);
    expect(merged.hasMore).toBe(true);
    expect(mergeNewestPage(prev, { items: [r('f', 6)], hasMore: true }, { reset: true }).items.map((i) => i.id)).toEqual(['f']);
  });
  it('hides items waiting out their undo window; appends without duplicates', () => {
    expect(mergeNewestPage([], { items: [r('b', 2), r('a', 1)], hasMore: false }, { hidden: new Set(['a']) }).items.map((i) => i.id)).toEqual(['b']);
    expect(appendOlderPage([r('b', 2)], { items: [r('b', 2), r('a', 1)], hasMore: false }).items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('gallery tags', () => {
  const s = (o: Partial<GenerationSettings>) => o as GenerationSettings;
  it('names what an image was made by', () => {
    expect(derivedTag(s({ generationMode: 'txt2img' }))).toBe(null);
    expect(derivedTag(s({ generationMode: 'upscale', upscale: { enabled: true, model: 'm', scale: 1.5 } }))).toBe('Upscale 1.5×');
    expect(derivedTag(s({ generationMode: 'upscale', upscale: { enabled: true, model: 'm', scale: 2, refine: true } }))).toBe('Enhance 2×');
    expect(derivedKind(s({ generationMode: 'outpaint', maskImage: 'm.png', outpaint: { left: 0, right: 0, top: 0, bottom: 0 } as never }))).toBe('Inpaint');
    expect(derivedKind(s({ generationMode: 'outpaint', outpaint: { left: 64, right: 0, top: 0, bottom: 0 } as never }))).toBe('Extend');
    expect(derivedKind(s({ generationMode: 'outpaint', maskImage: 'm.png', outpaint: { left: 64, right: 0, top: 0, bottom: 0 } as never }))).toBe('Inpaint & extend');
    expect(derivedTag(s({ generationMode: 'img2img' }))).toBe('Variation');
  });
});
