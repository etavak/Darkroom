import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as p from '@clack/prompts';
import { getConfig } from '../lib/env.js';
import { getServiceStatus } from '../lib/status.js';
import { readNvidiaSmi, readSystemSummary } from '../lib/sysinfo.js';
import { getComfyPython, getComfyUiRoot, getModelsRoot } from '../lib/paths.js';

function readAppleSiliconInfo() {
  if (process.platform !== 'darwin') return null;
  const lines = [];
  const brand = spawnSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' });
  if (brand.status === 0) lines.push(`CPU: ${(brand.stdout || '').trim()}`);
  const mem = spawnSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' });
  if (mem.status === 0) {
    const bytes = Number(mem.stdout?.trim());
    if (Number.isFinite(bytes)) lines.push(`Unified memory: ${(bytes / 1e9).toFixed(1)} GB`);
  }
  lines.push(`Arch: ${process.arch}${process.arch === 'arm64' ? ' (Apple Silicon · MPS available in PyTorch)' : ''}`);
  return lines.join('\n');
}

export async function diagnostics() {
  const cfg = getConfig();
  const status = await getServiceStatus();

  const lines = [
    readSystemSummary(),
    '',
    `Mode:    ${cfg.remote ? 'remote' : 'local'}`,
    `ComfyUI: ${status.comfy ? 'online' : 'offline'} (${status.comfyUrl})`,
    `Server:  ${status.server ? 'online' : 'offline'} (${status.appUrl})`,
    `Python:  ${cfg.remote ? '(remote — N/A)' : getComfyPython(cfg.comfyDir)}`,
    `UI root: ${cfg.remote ? '(remote)' : getComfyUiRoot(cfg.comfyDir) || '(unset)'}`,
    `Models:  ${cfg.remote ? '(remote)' : getModelsRoot(cfg.comfyDir) || '(unset)'}`,
  ];

  if (!cfg.remote && cfg.comfyDir && !fs.existsSync(cfg.comfyDir)) {
    lines.push('WARNING: COMFY_DIR path does not exist');
  }

  p.note(lines.join('\n'), 'System');

  if (process.platform === 'darwin') {
    const apple = readAppleSiliconInfo();
    if (apple) p.note(apple, 'Apple Silicon / MPS');
  } else {
    const gpu = readNvidiaSmi();
    if (gpu.ok) p.note(gpu.text, 'GPU (nvidia-smi)');
    else p.log.info(gpu.text);
  }

  if (status.lanUrls.length) {
    p.note(status.lanUrls.join('\n'), 'LAN URLs');
  }
}
