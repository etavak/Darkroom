import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import * as p from '@clack/prompts';
import { envPath } from '../lib/paths.js';
import { printBanner } from '../lib/banner.js';
import { handleCancel } from '../lib/prompt.js';
import { downloadSetupAssets } from './assets.js';
import { detectComfyInstalls, validateComfyInstall } from './detect.js';
import { installComfyFromSource, installComfyWindowsPortable } from './installComfy.js';
import { writeEnvFile } from './writeEnv.js';

function normalizeDraggedPath(raw) {
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  if (s.startsWith('file://')) {
    try {
      s = decodeURIComponent(new URL(s).pathname);
      if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(s)) s = s.slice(1);
    } catch {
      s = s.replace(/^file:\/\//, '');
    }
  }
  return s;
}

function hasNvidia() {
  if (process.platform === 'darwin') return false;
  const r = spawnSync('nvidia-smi', ['-L'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}

/**
 * First-run wizard when .env is missing.
 * @returns {Promise<void>}
 */
export async function runSetupWizard() {
  if (fs.existsSync(envPath)) return;

  await printBanner();
  p.intro('Darkroom setup');
  p.note(
    [
      `OS: ${process.platform} (${process.arch})`,
      'No .env found — let’s connect ComfyUI.',
    ].join('\n'),
    'Welcome',
  );

  const mode = await p.select({
    message: 'How will you use ComfyUI?',
    options: [
      { value: 'existing', label: 'Use existing ComfyUI', hint: 'auto-detect or paste a path' },
      {
        value: 'install',
        label: 'Install ComfyUI for me',
        hint:
          process.platform === 'win32'
            ? 'download Windows portable'
            : 'git clone + venv + torch',
      },
      {
        value: 'remote',
        label: 'Remote ComfyUI',
        hint: 'URL only · must use --listen',
      },
    ],
  });
  if (handleCancel(mode)) process.exit(0);

  /** @type {{ COMFY_MODE: string, COMFY_URL: string, COMFY_DIR?: string, COMFY_PYTHON?: string }} */
  let envVars = {
    COMFY_MODE: 'local',
    COMFY_URL: 'http://127.0.0.1:8188',
  };

  if (mode === 'remote') {
    p.log.warn(
      'Remote ComfyUI must be started with --listen 0.0.0.0 (or your LAN IP), not just localhost.',
    );
    const url = await p.text({
      message: 'ComfyUI base URL',
      placeholder: 'http://192.168.1.10:8188',
      initialValue: 'http://127.0.0.1:8188',
      validate: (v) => {
        if (!v?.trim()) return 'URL required';
        try {
          new URL(v.trim());
        } catch {
          return 'Invalid URL';
        }
      },
    });
    if (handleCancel(url)) process.exit(0);
    envVars = {
      COMFY_MODE: 'remote',
      COMFY_URL: String(url).trim().replace(/\/$/, ''),
    };
  } else if (mode === 'existing') {
    const detected = detectComfyInstalls();
    /** @type {string | symbol} */
    let chosenDir = '';

    if (detected.length > 0) {
      const pick = await p.select({
        message: 'Detected ComfyUI installs',
        options: [
          ...detected.map((d) => ({
            value: d.comfyDir,
            label: d.comfyDir,
            hint: d.label,
          })),
          { value: '__paste__', label: 'Paste a different path…' },
        ],
      });
      if (handleCancel(pick)) process.exit(0);
      chosenDir = pick === '__paste__' ? '' : String(pick);
    }

    if (!chosenDir) {
      const raw = await p.text({
        message: 'Path to ComfyUI (folder with main.py, or Windows portable root)',
        placeholder:
          process.platform === 'win32'
            ? 'C:\\Users\\you\\ComfyUI_windows_portable'
            : '~/ComfyUI',
        validate: (v) => (!v?.trim() ? 'Path required' : undefined),
      });
      if (handleCancel(raw)) process.exit(0);
      chosenDir = normalizeDraggedPath(String(raw));
    }

    const validated = validateComfyInstall(chosenDir);
    if (!validated) {
      p.log.error(
        'Could not validate that path (need main.py + a working Python: portable python_embeded, venv, or .venv).',
      );
      process.exit(1);
    }
    p.log.success(`Validated (${validated.kind}): ${validated.comfyDir}`);
    p.log.info(`Python: ${validated.python}`);

    envVars = {
      COMFY_MODE: 'local',
      COMFY_URL: 'http://127.0.0.1:8188',
      COMFY_DIR: validated.comfyDir,
      COMFY_PYTHON: validated.python,
    };
  } else {
    // install
    try {
      let installed;
      if (process.platform === 'win32') {
        const ok = await p.confirm({
          message:
            'Download the latest ComfyUI Windows portable (.7z) from GitHub? This is several GB.',
          initialValue: true,
        });
        if (handleCancel(ok) || !ok) process.exit(0);
        installed = await installComfyWindowsPortable();
      } else {
        let cuda = false;
        if (process.platform === 'linux' && hasNvidia()) {
          const pick = await p.select({
            message: 'NVIDIA GPU detected. Install PyTorch with CUDA?',
            options: [
              { value: 'cuda', label: 'CUDA 12.4 (recommended for NVIDIA)' },
              { value: 'cpu', label: 'CPU-only PyTorch' },
            ],
          });
          if (handleCancel(pick)) process.exit(0);
          cuda = pick === 'cuda';
        }
        installed = await installComfyFromSource({ cuda });
      }
      p.log.success(`ComfyUI ready at ${installed.comfyDir}`);
      envVars = {
        COMFY_MODE: 'local',
        COMFY_URL: 'http://127.0.0.1:8188',
        COMFY_DIR: installed.comfyDir,
        COMFY_PYTHON: installed.python,
      };
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  const s = p.spinner();
  s.start('Downloading tag dictionaries' + (envVars.COMFY_MODE === 'remote' ? '' : ' + TAESD') + '…');
  try {
    // Stop spinner so download progress can print
    s.stop('Fetching assets…');
    await downloadSetupAssets({
      comfyDir: envVars.COMFY_DIR,
      remote: envVars.COMFY_MODE === 'remote',
    });
  } catch (err) {
    p.log.warn(`Asset download issue: ${err instanceof Error ? err.message : err}`);
  }

  const written = writeEnvFile(envVars);
  p.log.success(`Wrote ${written}`);
  if (envVars.COMFY_MODE === 'remote') {
    p.note(
      'Model install / custom-node actions are hidden in remote mode.\nMake sure the remote ComfyUI process uses --listen.',
      'Remote mode',
    );
  }
  p.outro('Setup complete — opening Darkroom menu');
}
