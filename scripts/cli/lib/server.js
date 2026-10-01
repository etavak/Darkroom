import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './env.js';
import { waitForUrl } from './http.js';
import { clientDist, ensureLogsDir, logsDir, root, serverEntry } from './paths.js';
import { runNpm, setPid, spawnDetached } from './process.js';

/**
 * Build client/server dist if missing.
 */
export async function ensureBuilt() {
  if (!fs.existsSync(path.join(clientDist, 'index.html'))) {
    await runNpm(['run', 'build', '-w', 'client']);
  }
  if (!fs.existsSync(serverEntry)) {
    await runNpm(['run', 'build', '-w', 'server']);
  }
}

/**
 * @returns {Promise<{ started: boolean, alreadyRunning: boolean, appUrl: string }>}
 */
export async function ensureServerRunning() {
  const cfg = getConfig();
  const { httpGetOk } = await import('./http.js');
  if (await httpGetOk(`${cfg.appUrl}/api/health`)) {
    return { started: false, alreadyRunning: true, appUrl: cfg.appUrl };
  }

  await ensureBuilt();
  ensureLogsDir();
  const logFile = path.join(logsDir, 'server.log');
  fs.writeFileSync(logFile, `\n--- ${new Date().toISOString()} ---\n`, { flag: 'a' });

  const pid = spawnDetached(process.execPath, [serverEntry], {
    cwd: path.join(root, 'server'),
    env: {
      ...process.env,
      PORT: String(cfg.port),
      COMFY_URL: cfg.comfyUrl,
    },
    logFile,
  });
  setPid('server', pid, true);
  await waitForUrl(`${cfg.appUrl}/api/health`, 60_000, 'Darkroom server');
  return { started: true, alreadyRunning: false, appUrl: cfg.appUrl };
}
