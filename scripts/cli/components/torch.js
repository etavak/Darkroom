import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import * as p from '@clack/prompts';
import { loadAndApplyEnv } from '../lib/env.js';
import { detectAccelProfile, isIntelMac } from '../lib/hardware.js';
import { withOpLog } from '../lib/opLog.js';
import { loadPins } from '../lib/pins.js';
import { getComfyPython, getComfyUiRoot } from '../lib/paths.js';
import { runCommand } from '../lib/process.js';
import { withRestorePoint } from '../lib/restorePoint.js';
import { defaultConfirm } from './types.js';

function probeTorch(python) {
  const r = spawnSync(
    python,
    [
      '-c',
      'import torch; print(torch.__version__); print("mps" if getattr(torch.backends,"mps",None) and torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu"))',
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 60_000 },
  );
  if (r.status !== 0) return null;
  const lines = r.stdout.trim().split(/\r?\n/);
  return { version: lines[0], device: lines[1] || 'cpu' };
}

/**
 * @param {string} python
 * @param {'tested' | 'latest'} channel
 * @param {{ info: (m: string) => void }} log
 */
async function installTorchForHardware(python, channel, log) {
  const pins = loadPins();
  const profile = detectAccelProfile();
  const ver = channel === 'latest' ? '' : pins.torch?.tested;
  const pkgs = ver
    ? [`torch==${ver}`, `torchvision`, `torchaudio`]
    : ['torch', 'torchvision', 'torchaudio'];

  if (isIntelMac()) {
    const ok = await defaultConfirm(
      'Intel Mac: torch will run on CPU only (very slow). Continue?',
      false,
    );
    if (!ok) throw new Error('Torch install cancelled (Intel Mac)');
  }

  /** @type {string[]} */
  let extra = [];
  if (profile === 'nvidia') {
    extra = ['--index-url', pins.torch?.cudaIndex || 'https://download.pytorch.org/whl/cu124'];
    p.log.step('Installing PyTorch (CUDA)…');
  } else if (profile === 'apple_silicon' || profile === 'intel_mac') {
    p.log.step(
      profile === 'apple_silicon'
        ? 'Installing PyTorch (macOS / MPS wheels)…'
        : 'Installing PyTorch (CPU — Intel Mac)…',
    );
  } else {
    extra = ['--index-url', pins.torch?.cpuIndex || 'https://download.pytorch.org/whl/cpu'];
    p.log.step('Installing PyTorch (CPU)…');
  }

  log.info(`profile=${profile} pkgs=${pkgs.join(' ')}`);
  await runCommand(
    python,
    ['-m', 'pip', 'install', '--upgrade', '--retries', '10', '--timeout', '120', ...extra, ...pkgs],
    { stdio: 'inherit' },
  );
}

/** @type {import('./types.js').Component} */
export const torchComponent = {
  id: 'torch',
  name: 'PyTorch',

  async status() {
    loadAndApplyEnv();
    const dir = process.env.COMFY_DIR || '';
    if (!dir) return { state: 'missing', problems: ['COMFY_DIR not set'] };
    const python = getComfyPython(dir);
    if (!python || !fs.existsSync(python)) {
      return { state: 'missing', problems: ['ComfyUI Python not found'] };
    }

    // Windows portable: torch ships with the build
    if (process.platform === 'win32') {
      const t = probeTorch(python);
      if (t) {
        return {
          state: 'installed',
          version: t.version,
          detail: `${t.device} · portable`,
        };
      }
      return { state: 'broken', problems: ['torch not importable in portable Python'] };
    }

    const t = probeTorch(python);
    const pins = loadPins();
    if (!t) return { state: 'missing', problems: ['torch not installed'] };

    const profile = detectAccelProfile();
    /** @type {string[]} */
    const problems = [];
    if (profile === 'apple_silicon' && t.device !== 'mps') {
      problems.push('MPS not available — expected on Apple Silicon');
    }
    if (profile === 'nvidia' && t.device !== 'cuda') {
      problems.push('CUDA not available — NVIDIA GPU detected but torch is CPU build');
    }
    if (profile === 'intel_mac') {
      problems.push('Intel Mac: generation is CPU-only and very slow');
    }

    const tested = pins.torch?.tested;
    const update =
      tested && t.version && !String(t.version).startsWith(tested) ? 'update_available' : 'installed';

    return {
      state: problems.length && t.device === 'cpu' && profile === 'nvidia' ? 'broken' : update,
      version: t.version,
      testedVersion: tested,
      detail: t.device,
      problems: problems.length ? problems : undefined,
    };
  },

  async install(ctx = {}) {
    await withOpLog('torch', 'install', async (log) => {
      loadAndApplyEnv();
      const dir = process.env.COMFY_DIR;
      if (!dir) throw new Error('Install ComfyUI first');
      const python = getComfyPython(dir);
      if (!python || !fs.existsSync(python)) throw new Error('ComfyUI Python not found');

      if (process.platform === 'win32') {
        const t = probeTorch(python);
        if (t) {
          p.log.info(`Torch already present in portable build (${t.version} / ${t.device})`);
          log.info('skip — portable ships torch');
          return;
        }
        p.log.warn('Torch missing from portable — reinstall ComfyUI portable.');
        throw new Error('Repair via ComfyUI reinstall on Windows');
      }

      await installTorchForHardware(python, ctx.channel || 'tested', log);
    });
  },

  async update(ctx = {}) {
    if (process.platform === 'win32') {
      p.log.info('On Windows, update torch by updating the ComfyUI portable component.');
      return;
    }
    await withOpLog('torch', 'update', async (log) => {
      loadAndApplyEnv();
      const dir = process.env.COMFY_DIR;
      const ui = getComfyUiRoot(dir);
      const python = getComfyPython(dir);
      await withRestorePoint('torch', { comfyDir: ui || dir }, async () => {
        await installTorchForHardware(python, ctx.channel || 'tested', log);
      });
    });
  },

  async repair(ctx = {}) {
    return this.install(ctx);
  },

  async reinstall(ctx = {}) {
    return this.install(ctx);
  },

  async uninstall(ctx = {}) {
    if (process.platform === 'win32') {
      p.log.info('Torch is part of the ComfyUI portable — uninstall ComfyUI to remove it.');
      return;
    }
    const confirm = ctx.confirm || defaultConfirm;
    if (!(await confirm('Uninstall torch/torchvision/torchaudio from the ComfyUI venv?', false))) {
      return;
    }
    await withOpLog('torch', 'uninstall', async (log) => {
      loadAndApplyEnv();
      const python = getComfyPython(process.env.COMFY_DIR || '');
      await runCommand(python, ['-m', 'pip', 'uninstall', '-y', 'torch', 'torchvision', 'torchaudio'], {
        stdio: 'inherit',
      });
      log.info('Uninstalled torch packages');
    });
  },
};
