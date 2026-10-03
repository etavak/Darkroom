import * as p from '@clack/prompts';
import { buildStale, restartServer } from '../lib/server.js';

/** Rebuild (if needed) and restart only the Darkroom server; ComfyUI keeps running. */
export async function restartServerAction() {
  const stale = buildStale();
  const s = p.spinner();
  s.start(stale.client || stale.server ? 'Building the update and restarting the server…' : 'Restarting the server…');
  try {
    const r = await restartServer();
    if (r.restarted) {
      s.stop('Server restarted');
      p.log.info('Refresh Darkroom in your browser to load the new version.');
    } else {
      s.stop('Not restarted');
      if (r.reason) p.log.warn(r.reason);
    }
  } catch (err) {
    s.stop('Restart failed');
    p.log.error(err instanceof Error ? err.message : String(err));
  }
}
