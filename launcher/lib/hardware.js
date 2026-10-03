import { spawnSync } from 'node:child_process';

/**
 * @returns {'apple_silicon' | 'intel_mac' | 'nvidia' | 'cpu'}
 */
export function detectAccelProfile() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'apple_silicon' : 'intel_mac';
  }
  if (hasNvidiaGpu()) return 'nvidia';
  return 'cpu';
}

export function hasNvidiaGpu() {
  if (process.platform === 'darwin') return false;
  const r = spawnSync('nvidia-smi', ['-L'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  return r.status === 0;
}

export function isIntelMac() {
  return process.platform === 'darwin' && process.arch !== 'arm64';
}


/** Human-readable generation backend note for install prompts */
export function accelInstallNote() {
  const profile = detectAccelProfile();
  switch (profile) {
    case 'apple_silicon':
      return 'Apple Silicon — PyTorch will use MPS (Metal).';
    case 'intel_mac':
      return 'Intel Mac — no MPS GPU path; generation will be CPU-only and very slow.';
    case 'nvidia':
      return 'NVIDIA GPU detected — PyTorch CUDA build will be installed.';
    default:
      return 'No NVIDIA GPU detected — PyTorch CPU build will be installed.';
  }
}
