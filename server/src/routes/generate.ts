import { Router } from 'express';
import { ComfyError, interrupt } from '../services/comfyClient.js';
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
    await interrupt();
    if (jobId) {
      history.markFailed(jobId, 'Cancelled');
    }
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ComfyError) {
      res.status(502).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Cancel failed';
    res.status(500).json({ error: message });
  }
});
