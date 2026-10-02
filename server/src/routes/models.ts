import { Router } from 'express';
import { ComfyError } from '../services/comfyClient.js';
import { listModelCatalog } from '../services/modelLists.js';
import {
  confirmInstall,
  detectLocalPath,
  detectUploadedFile,
  getInstallJob,
  listInstalledModels,
  listModelTypeOptions,
  resolveModelFromUrl,
  startDownloadJob,
} from '../services/modelInstall.js';
import {
  analyzeModelDependencies,
  createDependencyPlan,
  executeDependencyPlan,
  getDependencyPlan,
  saveHfToken,
} from '../services/modelDependencies.js';
import { fetchSystemStatsSummary } from '../services/systemStats.js';

export const modelsRouter = Router();

modelsRouter.get('/', async (_req, res) => {
  try {
    const catalog = await listModelCatalog();
    res.json(catalog);
  } catch (err) {
    const message = err instanceof ComfyError ? err.message : 'Failed to fetch models';
    res.status(502).json({ error: message });
  }
});

/** Installed files on disk (with link metadata for Manage models). */
modelsRouter.get('/installed', async (req, res) => {
  try {
    const type = req.query.type ? String(req.query.type) : undefined;
    const items = await listInstalledModels(type);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

modelsRouter.get('/types', async (_req, res) => {
  try {
    const types = await listModelTypeOptions();
    res.json({ types });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

modelsRouter.get('/system', async (_req, res) => {
  const stats = await fetchSystemStatsSummary();
  res.json(stats);
});

modelsRouter.post('/resolve', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) {
    res.status(400).json({ error: 'url required' });
    return;
  }
  try {
    const job = await resolveModelFromUrl(url);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Resolve failed' });
  }
});

modelsRouter.post('/download', async (req, res) => {
  const jobId = String(req.body?.jobId || '');
  const candidatePath = req.body?.candidatePath ? String(req.body.candidatePath) : undefined;
  if (!jobId) {
    res.status(400).json({ error: 'jobId required' });
    return;
  }
  try {
    const job = await startDownloadJob(jobId, { candidatePath });
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Download failed' });
  }
});

modelsRouter.get('/jobs/:id', (req, res) => {
  const job = getInstallJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

modelsRouter.post('/upload', expressRawUpload, async (req, res) => {
  try {
    const name = String(req.query.name || 'model.safetensors');
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: 'Empty upload' });
      return;
    }
    const job = await detectUploadedFile(buf, name);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

modelsRouter.post('/from-path', async (req, res) => {
  const filePath = String(req.body?.path || '').trim();
  if (!filePath) {
    res.status(400).json({ error: 'path required' });
    return;
  }
  try {
    const job = await detectLocalPath(filePath);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Detect failed' });
  }
});

modelsRouter.post('/install', async (req, res) => {
  const jobId = String(req.body?.jobId || '');
  const type = String(req.body?.type || '');
  const family = req.body?.family ? String(req.body.family) : undefined;
  const rawMode = String(req.body?.mode || '');
  const mode =
    rawMode === 'move' || rawMode === 'link' || rawMode === 'copy'
      ? (rawMode as 'copy' | 'move' | 'link')
      : undefined;
  if (!jobId || !type) {
    res.status(400).json({ error: 'jobId and type required' });
    return;
  }
  try {
    const job = await confirmInstall({ jobId, type, family, mode });
    if (job.status === 'error') {
      res.status(400).json(job);
      return;
    }
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Install failed' });
  }
});

modelsRouter.post('/dependencies/analyze', async (req, res) => {
  const familyId = String(req.body?.familyId || '');
  const vramGB =
    typeof req.body?.vramGB === 'number' && Number.isFinite(req.body.vramGB)
      ? req.body.vramGB
      : undefined;
  const extras = Array.isArray(req.body?.extras) ? req.body.extras : undefined;
  if (!familyId && !extras?.length) {
    res.status(400).json({ error: 'familyId or extras required' });
    return;
  }
  try {
    const analysis = await analyzeModelDependencies({ familyId, vramGB, extras });
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Analyze failed' });
  }
});

modelsRouter.post('/dependencies/plan', async (req, res) => {
  const familyId = String(req.body?.familyId || '');
  const choices = Array.isArray(req.body?.choices) ? req.body.choices : [];
  const extras = Array.isArray(req.body?.extras) ? req.body.extras : undefined;
  const hfToken = req.body?.hfToken ? String(req.body.hfToken) : undefined;
  try {
    const plan = await createDependencyPlan({ familyId, choices, extras, hfToken });
    res.json(plan);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Plan failed' });
  }
});

modelsRouter.post('/dependencies/execute', async (req, res) => {
  const planId = String(req.body?.planId || '');
  const hfToken = req.body?.hfToken ? String(req.body.hfToken) : undefined;
  if (!planId) {
    res.status(400).json({ error: 'planId required' });
    return;
  }
  try {
    const plan = await executeDependencyPlan(planId, { hfToken });
    res.json(plan);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Execute failed' });
  }
});

modelsRouter.get('/dependencies/plans/:id', (req, res) => {
  const plan = getDependencyPlan(req.params.id);
  if (!plan) {
    res.status(404).json({ error: 'Plan not found' });
    return;
  }
  res.json(plan);
});

modelsRouter.post('/hf-token', (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) {
    res.status(400).json({ error: 'token required' });
    return;
  }
  try {
    saveHfToken(token);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Save failed' });
  }
});

/** Raw binary body for model uploads (up to ~30GB theoretical; practical limit lower). */
function expressRawUpload(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  if (req.headers['content-type']?.includes('application/json')) {
    res.status(415).json({ error: 'Send raw binary with ?name=' });
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const max = 40 * 1024 * 1024 * 1024; // 40 GB hard cap
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > max) {
      res.status(413).json({ error: 'File too large' });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    req.body = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
}
