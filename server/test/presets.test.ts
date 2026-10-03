import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePresets } from '../src/presets/resolve.js';

const families = fs.readdirSync(path.resolve(__dirname, '../presets/families')).map((f) => f.replace(/\.json$/, ''));
const base = { userPositive: '1girl, smile', userNegative: '', dismissedPositive: [], dismissedNegative: [] };

describe('presets', () => {
  it.each(families)('%s resolves with sensible settings', (id) => {
    const r = resolvePresets({ ...base, checkpoint: 'x.safetensors', familyId: id } as never);
    // Families resolve by mapping or explicit family; at least the settings must be complete
    expect(r.settings.baseRes).toBeGreaterThan(0);
  });
  it('maps official Anima files, and Turbo gets CFG 1 / 10 steps', () => {
    const aes = resolvePresets({ ...base, checkpoint: 'anima-aesthetic-v1.1.safetensors' });
    expect(aes).toMatchObject({ familyId: 'anima', settings: { cfg: 4, steps: 30, sampler: 'er_sde' } });
    expect(aes.finalPositive).toMatch(/^masterpiece, best quality, safe/);
    expect(aes.finalNegative).not.toMatch(/score_/);
    const turbo = resolvePresets({ ...base, checkpoint: 'anima-turbo-v1.1.safetensors' });
    expect(turbo.settings).toMatchObject({ cfg: 1, steps: 10, sampler: 'euler' });
  });
  it('the chosen quality / negative levels replace the defaults', () => {
    const r = resolvePresets({ ...base, checkpoint: 'anima-base-v1.0.safetensors', qualityPreset: 'base', negativePreset: 'none' });
    expect(r.finalPositive).toMatch(/score_7/);
    expect(r.finalNegative).toBe('');
  });
});
