import * as p from '@clack/prompts';
import { ensureComfyRunning } from '../lib/comfy.js';
import { getConfig } from '../lib/env.js';
import { openBrowser } from '../lib/process.js';
import { ensureServerRunning } from '../lib/server.js';
import { listLanUrls } from '../lib/status.js';

/**
 * @param {{ openBrowser?: boolean, printLan?: boolean }} [opts]
 */
export async function startStack(opts = {}) {
  const open = opts.openBrowser !== false;
  const printLan = opts.printLan === true;
  const cfg = getConfig();
  const s = p.spinner();

  s.start('Starting ComfyUI…');
  try {
    const comfy = await ensureComfyRunning();
    if (cfg.remote) {
      s.stop(comfy.alreadyRunning ? 'Remote ComfyUI reachable' : 'Remote ComfyUI ready');
    } else {
      s.stop(comfy.alreadyRunning ? 'ComfyUI already running' : 'ComfyUI ready');
    }
  } catch (err) {
    s.stop(cfg.remote ? 'Remote ComfyUI unreachable' : 'ComfyUI failed');
    p.log.error(err instanceof Error ? err.message : String(err));
    return;
  }

  s.start('Starting Darkroom server…');
  try {
    const server = await ensureServerRunning();
    s.stop(server.alreadyRunning ? 'Server already running' : 'Server ready');
  } catch (err) {
    s.stop('Server failed');
    p.log.error(err instanceof Error ? err.message : String(err));
    return;
  }

  if (open) {
    openBrowser(cfg.appUrl);
    p.log.success(`Opened ${cfg.appUrl}`);
  } else {
    p.log.success(`Server listening at ${cfg.appUrl}`);
  }

  if (printLan) {
    const lans = listLanUrls(cfg.port);
    if (lans.length === 0) {
      p.log.warn('No LAN IPv4 addresses found');
    } else {
      p.note(lans.join('\n'), 'LAN URL (other devices)');
    }
  }

  p.log.info('Processes keep running in the background. Use “Stop everything” to shut them down.');
}

export async function startDarkroom() {
  await startStack({ openBrowser: true, printLan: false });
}
