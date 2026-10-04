import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import * as p from '@clack/prompts';
import { getConfig } from '../lib/env.js';
import { getServiceStatus } from '../lib/status.js';
import { readNvidiaSmi, readSystemSummary } from '../lib/sysinfo.js';
import { videoControllerNames } from '../lib/hardware.js';
import { getComfyPython, getComfyUiRoot, getModelsRoot, root } from '../lib/paths.js';

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

/**
 * Windows limits paths to 260 characters unless long paths are turned on, and ComfyUI's
 * own files sit up to ~190 characters deep inside its folder.
 */
function windowsPathNotes() {
  const reg = spawnSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const enabled = /LongPathsEnabled\s+REG_DWORD\s+0x1/i.test(reg.stdout || '');
  const notes = [`Long paths: ${enabled ? 'on' : 'off'}`, `Darkroom folder path: ${root.length} characters`];
  if (!enabled && root.length > 60) {
    notes.push('  ComfyUI files can go past Windows’ 260-character limit from here — move Darkroom to a shorter folder (e.g. C:\\Darkroom) or turn on long paths.');
  }
  return notes;
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
    const hw = [`CPU: ${os.cpus()[0]?.model?.trim() || process.arch}`, `RAM: ${(os.totalmem() / 1e9).toFixed(1)} GB`];
    for (const name of videoControllerNames()) hw.push(`Graphics: ${name}`);
    if (process.platform === 'win32') hw.push(...windowsPathNotes());
    p.note(hw.join('\n'), 'Hardware');
    const gpu = readNvidiaSmi();
    if (gpu.ok) p.note(gpu.text, 'GPU (nvidia-smi)');
    else p.log.info(gpu.text);
  }

  if (status.lanUrls.length) {
    p.note(status.lanUrls.join('\n'), 'LAN URLs');
  }
}
