import { Router } from 'express';
import { ComfyError, cancelPrompt } from '../services/comfyClient.js';
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
    const result = await startGeneration(settings, { previewMethod });
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
