import * as p from '@clack/prompts';
import { httpGetOk } from '../lib/http.js';
import { getConfig } from '../lib/env.js';
import { clearPid, isPidAlive, killTree, readPids } from '../lib/process.js';
import { handleCancel } from '../lib/prompt.js';

export async function stopEverything() {
  const cfg = getConfig();
  const confirm = await p.confirm({
    message: 'Stop ComfyUI (if started by Darkroom) and the Darkroom server?',
    initialValue: true,
  });
  if (handleCancel(confirm) || !confirm) {
    p.log.info('Left running.');
    return;
  }

  const pids = readPids();
  const s = p.spinner();
  s.start('Stopping…');

  if (pids.server?.owned && pids.server.pid && isPidAlive(pids.server.pid)) {
    killTree(pids.server.pid);
    clearPid('server');
  } else if (pids.server) {
    clearPid('server');
  }

  if (pids.comfy?.owned && pids.comfy.pid && isPidAlive(pids.comfy.pid)) {
    killTree(pids.comfy.pid);
    clearPid('comfy');
  } else if (pids.comfy) {
    clearPid('comfy');
  }

  // Brief wait then report status
  await new Promise((r) => setTimeout(r, 500));
  const serverUp = await httpGetOk(`${cfg.appUrl}/api/health`);
  const comfyUp = await httpGetOk(`${cfg.comfyUrl}/system_stats`);
  s.stop('Stop requested');

  if (serverUp) {
    p.log.warn('Server still responds — it may have been started outside Darkroom.');
  } else {
    p.log.success('Darkroom server stopped (or was not running)');
  }
  if (comfyUp) {
    p.log.warn(
      'ComfyUI still responds — only processes Darkroom started are killed. Stop external ComfyUI manually if needed.',
    );
  } else {
    p.log.success('ComfyUI stopped (or was not running)');
  }
}
