import { spawnSync } from 'node:child_process';
import { root } from './paths.js';

/** System / GPU summaries for the Diagnostics menu. */

/**
 * @returns {{ ok: boolean, text: string }}
 */
export function readNvidiaSmi() {
  if (process.platform === 'darwin') {
    return { ok: false, text: 'nvidia-smi skipped on macOS — see Apple Silicon / MPS section' };
  }
  const r = spawnSync(
    'nvidia-smi',
    [
      '--query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu',
      '--format=csv,noheader',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r.error || r.status !== 0) {
    return { ok: false, text: 'nvidia-smi not available' };
  }
  return { ok: true, text: (r.stdout || '').trim() };
}

export function readSystemSummary() {
  const lines = [
    `Platform: ${process.platform} ${process.arch}`,
    `Node: ${process.version}`,
    `Darkroom: ${root}`,
    `COMFY_MODE: ${process.env.COMFY_MODE || 'local'}`,
    `COMFY_DIR: ${process.env.COMFY_DIR || '(not set)'}`,
    `COMFY_URL: ${process.env.COMFY_URL || '(default)'}`,
  ];
  return lines.join('\n');
}
