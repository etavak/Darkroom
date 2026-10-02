import { Router } from 'express';
import {
  getFamily,
  listFamilySummaries,
  listCheckpointMappings,
  resolvePresets,
  saveCheckpointMapping,
  type LayerSettings,
} from '../presets/index.js';

export const presetsRouter = Router();

presetsRouter.get('/families', (_req, res) => {
  res.json({ items: listFamilySummaries() });
});

presetsRouter.get('/checkpoints', (_req, res) => {
  res.json(listCheckpointMappings());
});

presetsRouter.post('/resolve', (req, res) => {
  try {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<
      string,
      unknown
    >;
    const strArr = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const resolved = resolvePresets({
      checkpoint: typeof b.checkpoint === 'string' ? b.checkpoint : '',
      styleId: typeof b.styleId === 'string' ? b.styleId : null,
      dismissedPositive: strArr(b.dismissedPositive),
      dismissedNegative: strArr(b.dismissedNegative),
      qualityPreset: typeof b.qualityPreset === 'string' ? b.qualityPreset : null,
      negativePreset: typeof b.negativePreset === 'string' ? b.negativePreset : null,
      userPositive: typeof b.userPositive === 'string' ? b.userPositive : '',
      userNegative: typeof b.userNegative === 'string' ? b.userNegative : '',
    });
    res.json(resolved);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Resolve failed' });
  }
});

presetsRouter.put('/checkpoints/:filename', (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<
      string,
      unknown
    >;
    if (typeof b.family !== 'string' || !b.family) {
      throw new Error('Missing family');
    }
    if (!getFamily(b.family)) {
      throw new Error(`Unknown family: ${b.family}`);
    }
    const settings = parseSettings(b.settings);
    const saved = saveCheckpointMapping(filename, {
      family: b.family,
      positive: strArr(b.positive),
      negative: strArr(b.negative),
      removePositive: strArr(b.removePositive),
      removeNegative: strArr(b.removeNegative),
      settings,
    });
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Save failed' });
  }
});

function strArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

function parseSettings(v: unknown): LayerSettings | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const out: LayerSettings = {};
  if (typeof o.cfg === 'number') out.cfg = o.cfg;
  if (typeof o.clipSkip === 'number') out.clipSkip = o.clipSkip;
  if (typeof o.sampler === 'string') out.sampler = o.sampler;
  if (typeof o.scheduler === 'string') out.scheduler = o.scheduler;
  if (typeof o.guidance === 'number') out.guidance = o.guidance;
  if (typeof o.baseRes === 'number') out.baseRes = o.baseRes;
  return out;
}
