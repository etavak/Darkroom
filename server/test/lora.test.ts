import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { listLoraMeta, loraThumbFile } from '../src/services/loraMeta.js';

const loras = path.join(process.env.COMFY_DIR!, 'models', 'loras');

/** A header-only safetensors file (Darkroom only reads the header). */
function lora(name: string, keys: string[], meta?: Record<string, string>) {
  const header: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, { dtype: 'F16', shape: [1], data_offsets: [0, 2] }]));
  if (meta) header.__metadata__ = meta;
  const json = Buffer.from(JSON.stringify(header));
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(json.length));
  fs.mkdirSync(path.dirname(path.join(loras, name)), { recursive: true });
  fs.writeFileSync(path.join(loras, name), Buffer.concat([len, json, Buffer.alloc(2)]));
}

beforeAll(() => {
  const sdxl = ['lora_te2_text_model.alpha', 'lora_unet_input_blocks_4.alpha'];
  lora('il_neon.safetensors', sdxl, { ss_sd_model_name: 'illustriousXL_v01.safetensors', ss_network_module: 'lycoris.kohya', ss_network_args: '{"algo":"locon"}', ss_network_dim: '64' });
  fs.writeFileSync(path.join(loras, 'il_neon.darkroom.json'), JSON.stringify({ modelName: 'Neon', triggerWords: ['neon glow'] }));
  fs.writeFileSync(path.join(loras, 'il_neon.preview.png'), 'png');
  lora('pony/pony_char.safetensors', sdxl);
  lora('animagine_style.safetensors', sdxl);
  lora('old.safetensors', ['lora_unet_down_blocks_0.alpha', 'lora_te_text_model.alpha']);
  lora('flux_detail.safetensors', ['lora_unet_double_blocks_0.alpha']);
  lora('mixed_anima.safetensors', ['lora_unet_blocks_0_cross_attn.alpha'], {
    'modelspec.architecture': 'anima-preview/lora',
    ss_tag_frequency: JSON.stringify({ d1: { '@artist one': 40, '@_@': 3, '1girl': 90, loli: 50, smile: 20 } }),
  });
  lora('weird.safetensors', ['x.alpha'], { 'modelspec.architecture': 'mystery-net-v2/lora' });
});

describe('what each LoRA was made for', () => {
  const by = () => Object.fromEntries(listLoraMeta().map((m) => [m.name, m]));
  it('reads base model, type, rank, triggers and preview', () => {
    const m = by()['il_neon.safetensors'];
    expect(m).toMatchObject({ base: 'Illustrious', family: 'illustrious', arch: 'sdxl', network: 'LyCORIS (LoCon)', rank: 64, triggers: ['neon glow'], thumb: true, title: 'Neon' });
    expect(loraThumbFile('il_neon.safetensors')).toMatch(/il_neon\.preview\.png$/);
  });
  it('uses the file name and tensor names when the metadata is silent', () => {
    expect(by()['pony/pony_char.safetensors']).toMatchObject({ base: 'Pony', arch: 'sdxl' });
    expect(by()['old.safetensors']).toMatchObject({ base: 'SD 1.5', arch: 'sd15' });
    expect(by()['flux_detail.safetensors']).toMatchObject({ arch: 'flux' });
  });
  it('Anima is its own base — "animagine" (an SDXL model) is not', () => {
    expect(by()['mixed_anima.safetensors']).toMatchObject({ base: 'Anima', family: 'anima', arch: 'anima' });
    expect(by()['animagine_style.safetensors'].family).not.toBe('anima');
  });
  it('an unknown base is shown by name and kept apart', () => {
    expect(by()['weird.safetensors']).toMatchObject({ base: 'Mystery Net', arch: 'other:mystery-net' });
  });
  it('training tags: style tokens first, no emoticons as styles, never tags for minors', () => {
    const tags = by()['mixed_anima.safetensors'].trainedTags.map((t) => t.tag);
    expect(tags[0]).toBe('@artist one');
    expect(tags).not.toContain('loli');
    expect(tags.indexOf('@_@')).toBeGreaterThan(tags.indexOf('@artist one'));
  });
  it('names outside the loras folders have no preview', () => {
    expect(loraThumbFile('../../main.py')).toBe(null);
  });
});
