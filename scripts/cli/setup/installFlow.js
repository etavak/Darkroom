import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as p from '@clack/prompts';
import { applyEnv, loadEnvFile } from '../lib/env.js';
import { root } from '../lib/paths.js';
import { handleCancel } from '../lib/prompt.js';
import { downloadSetupAssets } from './assets.js';
import { detectComfyInstalls, validateComfyInstall } from './detect.js';
import { installComfyFromSource, installComfyWindowsPortable } from './installComfy.js';
import { writeEnvFile } from './writeEnv.js';

/**
 * @param {string} raw
 */
export function normalizeDraggedPath(raw) {
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  if (s.startsWith('~')) {
    s = path.join(os.homedir(), s.slice(1).replace(/^[\\/]/, ''));
  }
  if (s.startsWith('file://')) {
    try {
      s = decodeURIComponent(new URL(s).pathname);
      if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(s)) s = s.slice(1);
    } catch {
      s = s.replace(/^file:\/\//, '');
    }
  }
  return path.resolve(s);
}

export function defaultInstallDir() {
  return process.platform === 'win32'
    ? path.join(root, 'ComfyUI_windows_portable')
    : path.join(root, 'ComfyUI');
}

/**
 * Ask where to install ComfyUI. Default = folder inside the Darkroom repo.
 * @returns {Promise<string | null>} absolute path, or null if cancelled
 */
export async function promptInstallLocation() {
  const defaultDir = defaultInstallDir();
  const existingHint = process.env.COMFY_DIR || '';
  const choice = await p.select({
    message: 'Where should ComfyUI be installed?',
    options: [
      {
        value: 'default',
        label: 'Inside Darkroom (recommended)',
        hint: defaultDir,
      },
      ...(existingHint && path.resolve(existingHint) !== path.resolve(defaultDir)
        ? [
            {
              value: 'current',
              label: 'Current COMFY_DIR',
              hint: existingHint,
            },
          ]
        : []),
      {
        value: 'custom',
        label: 'Custom path…',
        hint: 'pick another folder',
      },
    ],
  });
  if (handleCancel(choice)) return null;

  if (choice === 'default') return defaultDir;
  if (choice === 'current') return path.resolve(existingHint);

  const raw = await p.text({
    message: 'Install path',
    placeholder: defaultDir,
    initialValue: existingHint || defaultDir,
    validate: (v) => (!v?.trim() ? 'Path required' : undefined),
  });
  if (handleCancel(raw)) return null;
  return normalizeDraggedPath(String(raw));
}

export function hasNvidia() {
  if (process.platform === 'darwin') return false;
  const r = spawnSync('nvidia-smi', ['-L'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}

/**
 * Confirm replacing an existing install directory when needed.
 * @param {string} dest
 * @returns {Promise<boolean>}
 */
async function confirmReplaceIfNeeded(dest) {
  if (!fs.existsSync(dest)) return true;
  const isGit = fs.existsSync(path.join(dest, '.git'));
  if (process.platform !== 'win32' && isGit) {
    // Source installer will git pull + refresh deps in place.
    p.log.info(`Existing clone at ${dest} — will update in place.`);
    return true;
  }
  const ok = await p.confirm({
    message: `${dest} already exists. Replace it?`,
    initialValue: false,
  });
  if (handleCancel(ok) || !ok) return false;

  // Windows portable always extracts fresh; non-git folders can't be updated in place.
  if (process.platform === 'win32' || !isGit) {
    p.log.step(`Removing ${dest}…`);
    fs.rmSync(dest, { recursive: true, force: true });
  }
  return true;
}

/**
 * Interactive ComfyUI install / reinstall.
 * @returns {Promise<import('./detect.js').DetectedComfy | null>}
 */
export async function installComfyInteractive() {
  const installDir = await promptInstallLocation();
  if (!installDir) return null;

  if (!(await confirmReplaceIfNeeded(installDir))) return null;

  if (process.platform === 'win32') {
    const ok = await p.confirm({
      message:
        'Download the latest ComfyUI Windows portable (.7z) from GitHub? This is several GB.',
      initialValue: true,
    });
    if (handleCancel(ok) || !ok) return null;
    return installComfyWindowsPortable({ dest: installDir });
  }

  let cuda = false;
  if (process.platform === 'linux' && hasNvidia()) {
    const pick = await p.select({
      message: 'NVIDIA GPU detected. Install PyTorch with CUDA?',
      options: [
        { value: 'cuda', label: 'CUDA 12.4 (recommended for NVIDIA)' },
        { value: 'cpu', label: 'CPU-only PyTorch' },
      ],
    });
    if (handleCancel(pick)) return null;
    cuda = pick === 'cuda';
  }
  return installComfyFromSource({ cuda, dest: installDir });
}

/**
 * Point Darkroom at an existing ComfyUI install (source, portable, or Desktop).
 * @returns {Promise<import('./detect.js').DetectedComfy | null>}
 */
export async function pickExistingComfyInteractive() {
  const detected = detectComfyInstalls();
  /** @type {import('./detect.js').DetectedComfy | null} */
  let target = null;

  if (detected.length > 0) {
    const pick = await p.select({
      message: 'Detected ComfyUI installs',
      options: [
        ...detected.map((d, i) => ({
          value: String(i),
          label: d.label,
          hint: d.port ? `port ${d.port}` : d.kind,
        })),
        { value: '__paste__', label: 'Paste a different path…' },
      ],
    });
    if (handleCancel(pick)) return null;
    if (pick !== '__paste__') target = detected[Number(pick)] || null;
  }

  // Desktop config-only or missing python → ask for real path but keep port
  if (!target?.python) {
    const portHint = target?.port ? ` (Desktop port ${target.port})` : '';
    const raw = await p.text({
      message: `Path to ComfyUI (folder with main.py, or Windows portable root)${portHint}`,
      placeholder:
        process.platform === 'win32'
          ? 'C:\\Users\\you\\ComfyUI_windows_portable'
          : '~/ComfyUI',
      initialValue: process.env.COMFY_DIR || '',
      validate: (v) => (!v?.trim() ? 'Path required' : undefined),
    });
    if (handleCancel(raw)) return null;
    const validated = validateComfyInstall(normalizeDraggedPath(String(raw)));
    if (!validated) {
      p.log.error(
        'Could not validate that path (need main.py + a working Python: portable python_embeded, venv, or .venv).',
      );
      return null;
    }
    target = {
      ...validated,
      port: target?.port,
      url: target?.url,
    };
  }

  p.log.success(`Validated (${target.kind}): ${target.comfyDir}`);
  if (target.python) p.log.info(`Python: ${target.python}`);
  if (target.port) p.log.info(`Port: ${target.port}`);
  return target;
}

/**
 * Ask for a remote ComfyUI URL.
 * @returns {Promise<{ COMFY_MODE: string, COMFY_URL: string } | null>}
 */
export async function configureRemoteInteractive() {
  p.log.warn(
    'Remote ComfyUI must be started with --listen 0.0.0.0 (or your LAN IP), not just localhost.',
  );
  const url = await p.text({
    message: 'ComfyUI base URL',
    placeholder: 'http://192.168.1.10:8188',
    initialValue: process.env.COMFY_URL || 'http://127.0.0.1:8188',
    validate: (v) => {
      if (!v?.trim()) return 'URL required';
      try {
        new URL(v.trim());
      } catch {
        return 'Invalid URL';
      }
    },
  });
  if (handleCancel(url)) return null;
  return {
    COMFY_MODE: 'remote',
    COMFY_URL: String(url).trim().replace(/\/$/, ''),
  };
}

/**
 * Write .env, force-apply into process.env, download tags (+ TAESD when local).
 * @param {{ COMFY_MODE: string, COMFY_URL: string, COMFY_DIR?: string, COMFY_PYTHON?: string, PORT?: string }} envVars
 * @param {{ skipAssets?: boolean }} [opts]
 */
export async function persistComfyConfig(envVars, opts = {}) {
  if (!opts.skipAssets) {
    try {
      await downloadSetupAssets({
        comfyDir: envVars.COMFY_DIR,
        remote: envVars.COMFY_MODE === 'remote',
      });
    } catch (err) {
      p.log.warn(`Asset download issue: ${err instanceof Error ? err.message : err}`);
    }
  }

  const written = writeEnvFile(envVars);
  // Force-apply so menu actions see the new COMFY_* values immediately.
  applyEnv(loadEnvFile(written), { overwrite: true });
  p.log.success(`Wrote ${written}`);
  return written;
}
