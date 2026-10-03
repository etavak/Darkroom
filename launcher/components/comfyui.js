import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { loadAndApplyEnv, applyEnv, loadEnvFile } from '../lib/env.js';
import { accelInstallNote, isIntelMac } from '../lib/hardware.js';
import { withOpLog } from '../lib/opLog.js';
import { loadPins } from '../lib/pins.js';
import {
  getComfyPython,
  getComfyUiRoot,
  getGitBin,
  defaultComfyDir,
  getModelsRoot,
  runtimeDir,
} from '../lib/paths.js';
import { runCommand } from '../lib/process.js';
import { withRestorePoint } from '../lib/restorePoint.js';
import { validateComfyInstall } from '../setup/detect.js';
import { installComfyWindowsPortable } from '../setup/installComfy.js';
import { writeEnvFile } from '../setup/writeEnv.js';
import { getManagedPython } from './python.js';
import { defaultConfirm } from './types.js';

function defaultDest() {
  return defaultComfyDir();
}

function persistLocalEnv(validated, port = 8188) {
  const envVars = {
    COMFY_MODE: 'local',
    COMFY_URL: `http://127.0.0.1:${port}`,
    COMFY_DIR: validated.comfyDir,
    COMFY_PYTHON: validated.python,
  };
  writeEnvFile(envVars);
  applyEnv(loadEnvFile(), { overwrite: true });
  return envVars;
}

/**
 * @param {string} dest
 * @param {import('./types.js').ComponentContext} ctx
 * @param {{ info: (m: string) => void }} log
 */
async function installUnixSource(dest, ctx, log) {
  const pins = loadPins();
  const repo = pins.comfyui?.repo || 'https://github.com/comfyanonymous/ComfyUI.git';
  const ref = ctx.channel === 'latest' ? 'master' : pins.comfyui?.testedRef || 'master';
  const git = getGitBin();

  p.note(accelInstallNote(), 'Hardware');
  if (isIntelMac()) {
    const ok = await (ctx.confirm || defaultConfirm)(
      'This is an Intel Mac. Generation will be CPU-only and very slow. Continue installing ComfyUI?',
      false,
    );
    if (!ok) throw new Error('Install cancelled (Intel Mac CPU warning)');
  }

  const python = getManagedPython();
  if (!python) {
    throw new Error('Python 3.12 not ready — install the Python component (uv) first');
  }
  log.info(`Using Python: ${python}`);

  if (fs.existsSync(path.join(dest, '.git'))) {
    p.log.info('Existing git clone — updating…');
    await runCommand(git, ['pull', '--ff-only'], { cwd: dest, stdio: 'inherit' });
  } else if (fs.existsSync(dest) && fs.existsSync(path.join(dest, 'main.py'))) {
    p.log.info('Existing ComfyUI folder (no .git) — reusing');
  } else if (fs.existsSync(dest)) {
    throw new Error(`${dest} exists but is not a ComfyUI checkout`);
  } else {
    p.log.step('Cloning ComfyUI…');
    await runCommand(git, ['clone', '--depth', '1', '--branch', ref, repo, dest], {
      stdio: 'inherit',
    }).catch(async () => {
      // branch may not exist as named ref on shallow — clone default then checkout
      await runCommand(git, ['clone', '--depth', '1', repo, dest], { stdio: 'inherit' });
    });
  }

  const venvDir = path.join(dest, 'venv');
  const venvPython = path.join(venvDir, 'bin', 'python');
  if (!fs.existsSync(venvPython)) {
    p.log.step('Creating venv…');
    if (fs.existsSync(venvDir)) fs.rmSync(venvDir, { recursive: true, force: true });
    await runCommand(python, ['-m', 'venv', 'venv'], { cwd: dest, stdio: 'inherit' });
  }

  p.log.step('Upgrading pip…');
  await runCommand(
    venvPython,
    ['-m', 'pip', 'install', '--upgrade', '--retries', '10', '--timeout', '60', 'pip', 'wheel', 'setuptools'],
    { cwd: dest, stdio: 'inherit' },
  );

  p.log.step('Installing ComfyUI requirements…');
  await runCommand(
    venvPython,
    ['-m', 'pip', 'install', '--retries', '10', '--timeout', '60', '-r', 'requirements.txt'],
    { cwd: dest, stdio: 'inherit' },
  );

  const validated = validateComfyInstall(dest);
  if (!validated) throw new Error('ComfyUI install finished but validation failed');
  persistLocalEnv(validated);
  log.info(`ComfyUI ready at ${validated.comfyDir}`);
}

/** @type {import('./types.js').Component} */
export const comfyuiComponent = {
  id: 'comfyui',
  name: 'ComfyUI',
  platforms: ['*'],
  gpus: ['*'],

  async status() {
    loadAndApplyEnv();
    const dir = process.env.COMFY_DIR || '';
    if (!dir) {
      return { state: 'missing', problems: ['COMFY_DIR not set'] };
    }
    if (!fs.existsSync(dir)) {
      return { state: 'broken', problems: [`COMFY_DIR missing on disk: ${dir}`] };
    }
    const validated = validateComfyInstall(dir);
    if (!validated) {
      return { state: 'broken', detail: dir, problems: ['Could not validate ComfyUI install'] };
    }
    const ui = getComfyUiRoot(dir);
    let version = validated.kind;
    if (ui && fs.existsSync(path.join(ui, '.git'))) {
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync(getGitBin(), ['rev-parse', '--short', 'HEAD'], {
        cwd: ui,
        encoding: 'utf8',
        windowsHide: true,
      });
      if (r.status === 0) version = r.stdout.trim();
    }
    return {
      state: 'installed',
      version,
      detail: `${validated.kind} · ${validated.comfyDir}`,
    };
  },

  async install(ctx = {}) {
    await withOpLog('comfyui', 'install', async (log) => {
      const dest = ctx.installDir || defaultDest();
      if (process.platform === 'win32') {
        p.log.info('Windows: installing ComfyUI portable build…');
        const validated = await installComfyWindowsPortable({ dest });
        persistLocalEnv(validated);
        log.info(`Portable ready at ${validated.comfyDir}`);
        return;
      }
      await installUnixSource(dest, ctx, log);
    });
  },

  async update(ctx = {}) {
    await withOpLog('comfyui', 'update', async (log) => {
      loadAndApplyEnv();
      const dir = process.env.COMFY_DIR;
      if (!dir) throw new Error('COMFY_DIR not set');
      const ui = getComfyUiRoot(dir);
      if (!ui) throw new Error('Invalid COMFY_DIR');

      if (process.platform === 'win32') {
        const ok = await (ctx.confirm || defaultConfirm)(
          'Re-download the Windows portable to update ComfyUI?',
          true,
        );
        if (!ok) return;
        await withRestorePoint('comfyui', { comfyDir: ui }, async () => {
          const validated = await installComfyWindowsPortable({
            dest: ctx.installDir || dir,
          });
          persistLocalEnv(validated);
        });
        return;
      }

      if (!fs.existsSync(path.join(ui, '.git'))) {
        throw new Error('ComfyUI is not a git checkout — use Reinstall');
      }
      await withRestorePoint('comfyui', { comfyDir: ui }, async () => {
        await runCommand(getGitBin(), ['pull', '--ff-only'], { cwd: ui, stdio: 'inherit' });
        const py = getComfyPython(dir);
        await runCommand(py, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
          cwd: ui,
          stdio: 'inherit',
        });
        log.info('ComfyUI updated');
      });
    });
  },

  async repair(ctx = {}) {
    const st = await this.status();
    if (st.state === 'missing') return this.install(ctx);
    if (process.platform !== 'win32') {
      loadAndApplyEnv();
      const dir = process.env.COMFY_DIR;
      const ui = getComfyUiRoot(dir);
      const py = getComfyPython(dir);
      if (ui && py && fs.existsSync(py)) {
        await withOpLog('comfyui', 'repair', async (log) => {
          await runCommand(py, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
            cwd: ui,
            stdio: 'inherit',
          });
          log.info('Reinstalled requirements');
        });
        return;
      }
    }
    return this.reinstall(ctx);
  },

  async reinstall(ctx = {}) {
    await this.uninstall({ ...ctx, skipModelConfirm: false });
    await this.install(ctx);
  },

  async uninstall(ctx = {}) {
    loadAndApplyEnv();
    const dir = process.env.COMFY_DIR;
    if (!dir || !fs.existsSync(dir)) {
      p.log.info('No ComfyUI install to remove');
      return;
    }
    const confirm = ctx.confirm || defaultConfirm;
    if (!(await confirm(`Remove ComfyUI install at ${dir}?`, false))) return;

    const models = getModelsRoot(dir);
    const ui = getComfyUiRoot(dir);
    const sensitive = [];
    for (const rel of ['models', 'output', 'outputs']) {
      const pth = ui ? path.join(ui, rel) : path.join(dir, rel);
      if (fs.existsSync(pth)) sensitive.push(pth);
    }
    if (models && fs.existsSync(models) && !sensitive.includes(models)) sensitive.push(models);

    let wipeModels = false;
    if (sensitive.length) {
      wipeModels = await confirm(
        'Also delete models/ and output folders? (requires explicit yes)',
        false,
      );
    }

    await withOpLog('comfyui', 'uninstall', async (log) => {
      if (!wipeModels && sensitive.length) {
        // Move sensitive dirs aside under runtime backup, delete the rest
        const keepParent = path.join(runtimeDir, 'comfy-keep');
        fs.mkdirSync(keepParent, { recursive: true });
        for (const s of sensitive) {
          const base = path.basename(s);
          const dest = path.join(keepParent, `${base}-${Date.now()}`);
          try {
            fs.renameSync(s, dest);
            log.info(`Preserved ${s} → ${dest}`);
            p.log.info(`Preserved ${base} at ${dest}`);
          } catch (err) {
            log.warn(`Could not preserve ${s}: ${err}`);
          }
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
      // Also remove nested ComfyUI if portable parent
      log.info(`Removed ${dir}`);
    });
  },
};
