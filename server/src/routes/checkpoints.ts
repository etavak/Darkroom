import { Router } from 'express';
import { getObjectInfo, ComfyError } from '../services/comfyClient.js';

export const checkpointsRouter = Router();

checkpointsRouter.get('/', async (_req, res) => {
  try {
    const info = await getObjectInfo();
    const loader = info.CheckpointLoaderSimple as
      | {
          input?: {
            required?: {
              ckpt_name?: [string[]];
            };
          };
        }
      | undefined;

    const names = loader?.input?.required?.ckpt_name?.[0];
    if (!Array.isArray(names)) {
      res.json({ checkpoints: [] });
      return;
    }
    res.json({ checkpoints: names });
  } catch (err) {
    const message = err instanceof ComfyError ? err.message : 'Failed to fetch checkpoints';
    res.status(502).json({ error: message });
  }
});
