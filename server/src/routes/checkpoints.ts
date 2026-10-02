import { Router } from 'express';
import { ComfyError } from '../services/comfyClient.js';
import { listModelCatalog } from '../services/modelLists.js';

export const checkpointsRouter = Router();

/** @deprecated Prefer GET /api/models — kept for older clients. */
checkpointsRouter.get('/', async (_req, res) => {
  try {
    const catalog = await listModelCatalog();
    res.json({ checkpoints: catalog.checkpoints });
  } catch (err) {
    const message = err instanceof ComfyError ? err.message : 'Failed to fetch checkpoints';
    res.status(502).json({ error: message });
  }
});
