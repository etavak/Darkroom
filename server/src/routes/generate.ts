import { Router } from 'express';
import { ComfyError, cancelPrompt, getPromptQueuePosition } from '../services/comfyClient.js';
import { startGeneration, validateSettings } from '../services/generation.js';
import * as history from '../services/history.js';

export const generateRouter = Router();

generateRouter.post('/', async (req, res) => {
  try {
    const settings = validateSettings(req.body);
    const previewMethod =
      req.body?.previewMethod === 'latent2rgb' ||
      req.body?.previewMethod === 'taesd' ||
      req.body?.previewMethod === 'none' ||
      req.body?.previewMethod === 'auto'
        ? req.body.previewMethod
        : undefined;
    const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId : undefined;
    const result = await startGeneration(settings, { previewMethod, clientId });
    res.status(202).json(result);
  } catch (err) {
    if (err instanceof ComfyError) {
      res.status(502).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Generation failed';
    const status = message.startsWith('Missing') || message.startsWith('Invalid') ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

/** Where a job stands in ComfyUI (for "why isn't it moving?"): queued behind N, running, done, failed or gone. */
generateRouter.get('/status/:jobId', async (req, res) => {
  const job = history.getGeneration(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'No such job' });
    return;
  }
  if (job.status !== 'pending') {
    res.json({ state: job.status === 'completed' ? 'done' : 'failed', ahead: 0 });
    return;
  }
  try {
    const q = await getPromptQueuePosition(job.promptId);
    res.json({ state: q.state === 'pending' ? 'queued' : q.state === 'running' ? 'running' : 'missing', ahead: q.ahead });
  } catch {
    res.json({ state: 'unreachable', ahead: 0 });
  }
});

generateRouter.post('/cancel', async (req, res) => {
  try {
    const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : null;
    const job = jobId ? history.getGeneration(jobId) : null;
    if (!job) {
      // Nothing of ours to cancel — never interrupt another device's job blindly
      res.json({ ok: true, result: 'not_found' });
      return;
    }
    if (job.status !== 'pending') {
      res.json({ ok: true, result: job.status });
      return;
    }
    // Mark first so the watcher stops even if ComfyUI is slow to respond
    history.markFailed(job.id, 'Cancelled');
    const result = await cancelPrompt(job.promptId);
    res.json({ ok: true, result });
  } catch (err) {
    if (err instanceof ComfyError) {
      res.status(502).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Cancel failed';
    res.status(500).json({ error: message });
  }
});
