import os from 'node:os';
import { config } from '../config.js';

export type SystemStatsSummary = {
  ok: boolean;
  label: string;
  deviceName: string | null;
  backend: string | null;
  vramTotal: number | null;
  vramFree: number | null;
  vramTooltip: string | null;
  raw?: unknown;
};

type ComfyDevice = {
  name?: string;
  type?: string;
  index?: number;
  vram_total?: number;
  vram_free?: number;
  torch_vram_total?: number;
  torch_vram_free?: number;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} GB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function appleChipName(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const model = os.cpus()[0]?.model || '';
    // "Apple M4 Pro" etc.
    const m = model.match(/Apple\s+(M\d+\s*(?:Pro|Max|Ultra)?)/i);
    if (m) return `Apple ${m[1].replace(/\s+/g, ' ').trim()}`;
    if (/Apple/i.test(model)) return model.replace(/\s+CPU.*/i, '').trim();
  } catch {
    // ignore
  }
  return process.arch === 'arm64' ? 'Apple Silicon' : null;
}

function backendLabel(type: string | undefined, name: string | undefined): string {
  const t = (type || name || '').toLowerCase();
  // AMD's ROCm builds of PyTorch present the card as "cuda"
  if (/\b(amd|radeon)\b/i.test(name || '')) return 'ROCm';
  if (t.includes('xpu')) return 'XPU';
  if (t.includes('mps') || t === 'mps') return 'MPS';
  if (t.includes('cuda') || t.startsWith('cuda')) return 'CUDA';
  if (t.includes('cpu')) return 'CPU';
  if (t.includes('directml')) return 'DirectML';
  if (type) return type.toUpperCase();
  return 'GPU';
}

function deviceDisplayName(dev: ComfyDevice): string {
  const raw = String(dev.name || '').trim();
  if (/^mps$/i.test(raw) || !raw) {
    return appleChipName() || raw || 'GPU';
  }
  // "cuda:0 NVIDIA GeForce RTX 4090" → prefer the product name
  const nvidia = raw.match(/NVIDIA\s+.+$/i);
  if (nvidia) return nvidia[0].replace(/\s+/g, ' ').trim();
  return raw.replace(/^cuda:\d+\s*/i, '').trim() || raw;
}

export async function fetchSystemStatsSummary(): Promise<SystemStatsSummary> {
  try {
    const res = await fetch(`${config.comfyUrl}/system_stats`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      return {
        ok: false,
        label: 'ComfyUI offline',
        deviceName: null,
        backend: null,
        vramTotal: null,
        vramFree: null,
        vramTooltip: null,
      };
    }
    const raw = (await res.json()) as {
      devices?: ComfyDevice[];
      system?: Record<string, unknown>;
    };
    const devices = Array.isArray(raw.devices) ? raw.devices : [];
    const primary =
      devices.find((d) => {
        const t = String(d.type || d.name || '').toLowerCase();
        return t.includes('cuda') || t.includes('mps') || t.includes('xpu') || t.includes('gpu');
      }) || devices[0];

    if (!primary) {
      const chip = appleChipName();
      return {
        ok: true,
        label: chip ? `${chip} - CPU` : 'CPU',
        deviceName: chip,
        backend: 'CPU',
        vramTotal: null,
        vramFree: null,
        vramTooltip: null,
        raw,
      };
    }

    const deviceName = deviceDisplayName(primary);
    const backend = backendLabel(primary.type, primary.name);
    const vramTotal = Number(primary.vram_total || primary.torch_vram_total || 0) || null;
    const vramFree = Number(primary.vram_free || primary.torch_vram_free || 0) || null;
    const vramTooltip =
      vramTotal != null
        ? `VRAM ${vramFree != null ? `${formatBytes(vramFree)} free / ` : ''}${formatBytes(vramTotal)} total`
        : null;

    return {
      ok: true,
      label: `${deviceName} - ${backend}`,
      deviceName,
      backend,
      vramTotal,
      vramFree,
      vramTooltip,
      raw,
    };
  } catch {
    return {
      ok: false,
      label: 'ComfyUI offline',
      deviceName: null,
      backend: null,
      vramTotal: null,
      vramFree: null,
      vramTooltip: null,
    };
  }
}
