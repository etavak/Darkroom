import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import * as p from '@clack/prompts';
import { loadAndApplyEnv } from '../lib/env.js';
import path from 'node:path';
import { comfyStoppedFor } from '../lib/comfy.js';
import { detectAccelProfile, detectGpu, isIntelMac } from '../lib/hardware.js';
import { withOpLog } from '../lib/opLog.js';
import { loadPins } from '../lib/pins.js';
import { getComfyPortableRoot, getComfyPython, getComfyUiRoot } from '../lib/paths.js';
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

/** The Windows portable build: its own Python, with PyTorch chosen by ComfyUI for one GPU family. */
function isPortable(dir) {
  return fs.existsSync(path.join(getComfyPortableRoot(dir) || dir, 'python_embeded', 'python.exe'));
}

/**
 * Where pip finds PyTorch builds like an installed one: "2.14.0+cu130" → the cu130 index,
 * "+xpu" → Intel, "+cpu" → CPU. AMD's Windows (ROCm) builds aren't on that index.
 * @param {string} version
 */
export function torchIndexFor(version) {
  const m = /\+(cu\d+|xpu|cpu)\b/.exec(version);
  return m ? `https://download.pytorch.org/whl/${m[1]}` : null;
}

/**
 * The PyTorch index for this PC's graphics card on Windows (for a portable whose PyTorch is gone).
 * CUDA 13 builds stop at the RTX 20 series (compute capability 7.5); older cards need 12.6.
 */
function windowsTorchIndex() {
  const gpu = detectGpu();
  if (gpu.vendor === 'nvidia') return `https://download.pytorch.org/whl/${gpu.computeCap !== null && gpu.computeCap < 7.5 ? 'cu126' : 'cu130'}`;
  if (gpu.vendor === 'intel') return 'https://download.pytorch.org/whl/xpu';
  if (gpu.vendor === 'amd') return null;
  return 'https://download.pytorch.org/whl/cpu';
}

/**
 * pip into the portable's Python, the way ComfyUI's own update_comfyui_and_python_dependencies.bat does.
 * @param {string} python
 * @param {string} index
 */
async function pipPortableTorch(python, index) {
  await runCommand(
    python,
    ['-s', '-m', 'pip', 'install', '--upgrade', '--retries', '10', '--timeout', '120', 'torch', 'torchvision', 'torchaudio', '--extra-index-url', index],
    { stdio: 'inherit' },
  );
}

/**
 * @param {string} python
 * @param {'tested' | 'latest'} channel
 * @param {{ info: (m: string) => void }} log
 */
async function installTorchForHardware(python, channel, log) {
  const pins = loadPins();
  const profile = detectAccelProfile();
  /** @type {string[]} */
  let pkgs;
  if (channel === 'latest') {
    pkgs = ['torch', 'torchvision', 'torchaudio'];
  } else {
    const ver = pins.torch?.tested || '2.7.1';
    const vision = pins.torch?.torchvision || '0.22.1';
    const audio = pins.torch?.torchaudio || '2.7.1';
    // Pin all three — unpinned vision/audio can resolve to mismatched majors.
    pkgs = [`torch==${ver}`, `torchvision==${vision}`, `torchaudio==${audio}`];
  }

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
    ['-s', '-m', 'pip', 'install', '--upgrade', '--retries', '10', '--timeout', '120', ...extra, ...pkgs],
    { stdio: 'inherit' },
  );
}

/** @type {import('./types.js').Component} */
export const torchComponent = {
  id: 'torch',
  name: 'PyTorch',
  platforms: ['*'],
  gpus: ['*'],

  async status() {
    loadAndApplyEnv();
    const dir = process.env.COMFY_DIR || '';
    if (!dir) return { state: 'missing', problems: ['COMFY_DIR not set'] };
    const python = getComfyPython(dir);
    if (!python || !fs.existsSync(python)) {
      return { state: 'missing', problems: ['ComfyUI Python not found'] };
    }

    // Windows portable: torch ships with the build
    if (isPortable(dir)) {
      const t = probeTorch(python);
      if (!t) return { state: 'broken', problems: ['torch not importable in portable Python'] };
      const gpu = detectGpu();
      const cpuOnly = (process.env.COMFY_FORCE_CPU || '').toLowerCase() === 'true';
      const problems = gpu.vendor !== 'none' && t.device === 'cpu' && !cpuOnly ? [`${gpu.name || 'The graphics card'} isn't being used — PyTorch only sees the CPU`] : [];
      return {
        state: problems.length ? 'broken' : 'installed',
        version: t.version,
        detail: `${t.device} · portable`,
        problems: problems.length ? problems : undefined,
      };
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

      if (isPortable(dir)) {
        const t = probeTorch(python);
        if (t) {
          p.log.info(`Torch already present in portable build (${t.version} / ${t.device})`);
          log.info('skip — portable ships torch');
          return;
        }
        const index = windowsTorchIndex();
        if (!index) throw new Error("PyTorch is missing from ComfyUI's AMD build, and pip can't install that one — reinstall ComfyUI.");
        p.log.step('Installing PyTorch into the portable ComfyUI…');
        await comfyStoppedFor(ctx, defaultConfirm, () => pipPortableTorch(python, index));
        return;
      }

      await comfyStoppedFor(ctx, defaultConfirm, () => installTorchForHardware(python, ctx.channel || 'tested', log));
    });
  },

  async update(ctx = {}) {
    await withOpLog('torch', 'update', async (log) => {
      loadAndApplyEnv();
      const dir = process.env.COMFY_DIR;
      const ui = getComfyUiRoot(dir);
      const python = getComfyPython(dir);
      if (isPortable(dir)) {
        // ComfyUI chose this PyTorch for the build; "latest" upgrades it within the same
        // build (same CUDA version / Intel / CPU)
        if (ctx.channel !== 'latest') {
          p.log.info('The portable ComfyUI’s own PyTorch is the tested one — choose "Update to latest" to upgrade it.');
          return;
        }
        const t = probeTorch(python);
        const index = t ? torchIndexFor(t.version) : windowsTorchIndex();
        if (!index) throw new Error('This PyTorch (AMD build) can’t be upgraded with pip — update ComfyUI by reinstalling it.');
        await comfyStoppedFor(ctx, defaultConfirm, () =>
          withRestorePoint('torch', { comfyDir: ui || dir }, async () => {
            await pipPortableTorch(python, index);
            log.info(`upgraded from ${index}`);
          }),
        );
        return;
      }
      await comfyStoppedFor(ctx, defaultConfirm, () =>
        withRestorePoint('torch', { comfyDir: ui || dir }, async () => {
          await installTorchForHardware(python, ctx.channel || 'tested', log);
        }),
      );
    });
  },

  async repair(ctx = {}) {
    return this.install(ctx);
  },

  async reinstall(ctx = {}) {
    return this.install(ctx);
  },

  async uninstall(ctx = {}) {
    if (isPortable(process.env.COMFY_DIR || '')) {
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
      await runCommand(python, ['-s', '-m', 'pip', 'uninstall', '-y', 'torch', 'torchvision', 'torchaudio'], {
        stdio: 'inherit',
      });
      log.info('Uninstalled torch packages');
    });
  },
};
