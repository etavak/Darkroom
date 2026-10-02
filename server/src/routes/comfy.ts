import { Router } from 'express';
import { loadComfyLauncherModule } from '../services/cliShared.js';
import { pingComfy } from '../services/comfyClient.js';

export const comfyRouter = Router();

/**
 * Start local ComfyUI from the web UI. Uses the CLI launcher so flags (VRAM mode,
 * preview method) match, and the process is recorded for "Stop everything".
 * Returns immediately; the client's health poll picks up readiness.
 */
comfyRouter.post('/start', async (_req, res) => {
  if ((process.env.COMFY_MODE || 'local').toLowerCase() === 'remote') {
    res.status(400).json({ error: 'Cannot start ComfyUI in remote mode' });
    return;
  }
  if (await pingComfy()) {
    res.json({ ok: true, alreadyRunning: true });
    return;
  }
  try {
    const { startComfyProcess } = await loadComfyLauncherModule();
    startComfyProcess();
    res.json({ ok: true, alreadyRunning: false });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to start' });
  }
});
