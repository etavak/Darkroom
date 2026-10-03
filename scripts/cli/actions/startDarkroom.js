import * as p from '@clack/prompts';
import { ensureComfyRunning } from '../lib/comfy.js';
import { getConfig } from '../lib/env.js';
import { httpGetJson } from '../lib/http.js';
import { openBrowser } from '../lib/process.js';
import { buildStale, ensureServerRunning, restartServer } from '../lib/server.js';
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
    if (server.alreadyRunning) {
      // Running an older build: apply the update without touching ComfyUI
      const stale = buildStale();
      if (stale.server || stale.client) {
        s.message('Applying the update — restarting the server…');
        const r = await restartServer();
        s.stop(r.restarted ? 'Server restarted with the update' : 'Server already running');
        if (!r.restarted && r.reason) p.log.warn(r.reason);
      } else {
        s.stop('Server already running');
      }
    } else {
      s.stop('Server ready');
    }
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

  const lans = listLanUrls(cfg.port);
  const pin = await fetchLanPin(cfg.appUrl);
  if (printLan) {
    if (lans.length === 0) {
      p.log.warn('No LAN IPv4 addresses found');
    } else {
      p.note(
        [...lans, '', pin ? `PIN: ${pin}` : 'PIN: see Preferences → Network'].join('\n'),
        'Other devices on your network',
      );
    }
  } else if (lans.length && pin) {
    p.log.info(`Phone / tablet: ${lans[0]} · PIN ${pin}`);
  }

  p.log.info('Processes keep running in the background. Use “Stop everything” to shut them down.');
}

/** The server only reveals the LAN PIN to requests from this computer. */
async function fetchLanPin(appUrl) {
  try {
    const res = await httpGetJson(`${appUrl}/api/auth/lan`, { timeoutMs: 5000 });
    return res.status === 200 && typeof res.json?.pin === 'string' ? res.json.pin : null;
  } catch {
    return null;
  }
}

export async function startDarkroom() {
  await startStack({ openBrowser: true, printLan: false });
}
