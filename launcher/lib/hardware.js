import { spawnSync } from 'node:child_process';

/**
 * @typedef {'apple_silicon' | 'intel_mac' | 'nvidia' | 'amd' | 'intel_gpu' | 'cpu'} AccelProfile
 * @typedef {{ vendor: 'nvidia' | 'amd' | 'intel' | 'none', name: string | null, computeCap: number | null }} GpuInfo
 */

/**
 * @returns {AccelProfile}
 */
export function detectAccelProfile() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'apple_silicon' : 'intel_mac';
  }
  const gpu = detectGpu();
  if (gpu.vendor === 'nvidia') return 'nvidia';
  if (gpu.vendor === 'amd') return 'amd';
  if (gpu.vendor === 'intel') return 'intel_gpu';
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

/** Display adapter names (Windows: from WMI; Linux: lspci). */
export function videoControllerNames() {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20_000,
    });
    return (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  if (process.platform === 'linux') {
    const r = spawnSync('lspci', [], { encoding: 'utf8', timeout: 10_000 });
    return (r.stdout || '').split('\n').filter((l) => /VGA|3D|Display/i.test(l)).map((l) => l.replace(/^.*?:\s*/, '').trim());
  }
  return [];
}

/**
 * Which ComfyUI build fits a set of display adapters. Only cards ComfyUI's AMD / Intel builds
 * can use count: a discrete Radeon (or Radeon 8000-series APU), and Intel Arc (cards and the
 * Core Ultra "Arc" graphics). Plain integrated graphics run on the CPU.
 * @param {string[]} names
 * @returns {GpuInfo}
 */
export function gpuFromNames(names) {
  const amd = names.find((n) => /\bRadeon\b/i.test(n) && /\b(RX|PRO|AI)\b|Radeon\s*(\(TM\)\s*)?\d{3,4}[A-Z]?\b/i.test(n));
  if (amd) return { vendor: 'amd', name: amd, computeCap: null };
  const intel = names.find((n) => /\bIntel\b/i.test(n) && /\bArc\b/i.test(n));
  if (intel) return { vendor: 'intel', name: intel, computeCap: null };
  return { vendor: 'none', name: names[0] ?? null, computeCap: null };
}

/**
 * The graphics card ComfyUI would use on Windows / Linux (Macs use MPS and aren't asked).
 * NVIDIA's compute capability tells the newest CUDA build apart from the one for older cards.
 * @returns {GpuInfo}
 */
export function detectGpu() {
  if (process.platform === 'darwin') return { vendor: 'none', name: null, computeCap: null };
  const smi = spawnSync('nvidia-smi', ['--query-gpu=name,compute_cap', '--format=csv,noheader'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  if (smi.status === 0 && smi.stdout.trim()) {
    const [name, cap] = smi.stdout.trim().split(/\r?\n/)[0].split(',').map((s) => s.trim());
    return { vendor: 'nvidia', name: name || null, computeCap: Number(cap) || null };
  }
  // Older drivers don't know compute_cap
  if (hasNvidiaGpu()) return { vendor: 'nvidia', name: null, computeCap: null };
  return gpuFromNames(videoControllerNames());
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
    case 'amd':
      return 'AMD Radeon GPU detected — ComfyUI’s AMD (ROCm) build will be used where available. Older Radeon cards may only run on the CPU.';
    case 'intel_gpu':
      return 'Intel Arc GPU detected — ComfyUI’s Intel (XPU) build will be used where available.';
    default:
      return 'No supported GPU detected — generation will run on the CPU (slow).';
  }
}
