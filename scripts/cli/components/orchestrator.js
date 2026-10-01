import path from 'node:path';
import * as p from '@clack/prompts';
import { applyEnv, loadEnvFile } from '../lib/env.js';
import { accelInstallNote, isIntelMac } from '../lib/hardware.js';
import { root } from '../lib/paths.js';
import { handleCancel } from '../lib/prompt.js';
import { writeEnvFile } from '../setup/writeEnv.js';
import {
  listComponents,
  listCoreInstallOrder,
  listCudaOnlyInstalledOnMac,
  formatStatusLine,
} from './registry.js';
import { defaultConfirm } from './types.js';

/**
 * Ask once for ComfyUI install directory.
 * @returns {Promise<string | null>}
 */
export async function promptComfyInstallDir() {
  const defaultDir =
    process.platform === 'win32'
      ? path.join(root, 'ComfyUI_windows_portable')
      : path.join(root, 'ComfyUI');

  const choice = await p.select({
    message: 'Where should ComfyUI be installed?',
    options: [
      { value: 'default', label: 'Inside Darkroom (recommended)', hint: defaultDir },
      { value: 'custom', label: 'Custom path…' },
    ],
  });
  if (handleCancel(choice)) return null;
  if (choice === 'default') return defaultDir;

  const raw = await p.text({
    message: 'Install path',
    initialValue: defaultDir,
    validate: (v) => (!v?.trim() ? 'Path required' : undefined),
  });
  if (handleCancel(raw)) return null;
  return path.resolve(String(raw).trim());
}

/**
 * Install all missing core components in order.
 * @param {{ installDir?: string, channel?: 'tested' | 'latest' }} [opts]
 */
export async function installEverything(opts = {}) {
  p.note(accelInstallNote(), 'Hardware');
  if (isIntelMac()) {
    const ok = await defaultConfirm(
      'Intel Mac detected: image generation will be CPU-only and very slow. Continue with Install everything?',
      false,
    );
    if (!ok) {
      p.log.warn('Install everything cancelled');
      return;
    }
  }

  let installDir = opts.installDir;
  if (!installDir) {
    installDir = (await promptComfyInstallDir()) || undefined;
    if (!installDir) return;
  }

  const channel = opts.channel || 'tested';
  const order = listCoreInstallOrder();

  for (const comp of order) {
    const st = await comp.status();
    if (st.state === 'installed') {
      p.log.info(`✓ ${comp.name} (${formatStatusLine(st)})`);
      continue;
    }
    p.log.step(`Installing ${comp.name}…`);
    try {
      await comp.install({ channel, installDir });
      p.log.success(`${comp.name} ready`);
    } catch (err) {
      p.log.error(`${comp.name}: ${err instanceof Error ? err.message : err}`);
      const cont = await defaultConfirm('Continue with remaining components?', true);
      if (!cont) throw err;
    }
  }
  p.log.success('Install everything finished');
}

/**
 * After pointing at an existing install: repair deps that still apply.
 * @param {{ comfyDir: string, python?: string, port?: number, url?: string }} target
 */
export async function configureExistingAndRepair(target) {
  const port = target.port || 8188;
  const url = target.url || `http://127.0.0.1:${port}`;

  if (!target.python) {
    p.log.warn(
      `Detected Desktop port ${port}. Select a ComfyUI folder that contains main.py, or set COMFY_DIR manually.`,
    );
    writeEnvFile({
      COMFY_MODE: 'local',
      COMFY_URL: url,
    });
    applyEnv(loadEnvFile(), { overwrite: true });
    return;
  }

  writeEnvFile({
    COMFY_MODE: 'local',
    COMFY_URL: url,
    COMFY_DIR: target.comfyDir,
    COMFY_PYTHON: target.python,
  });
  applyEnv(loadEnvFile(), { overwrite: true });

  for (const id of ['tags', 'taesd', 'darkroom']) {
    const comp = listComponents().find((c) => c.id === id);
    if (!comp) continue;
    const st = await comp.status();
    if (st.state === 'installed') continue;
    try {
      p.log.step(`Repairing ${comp.name}…`);
      await comp.repair({});
    } catch (err) {
      p.log.warn(`${comp.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * Remote mode: write env + tags only.
 * @param {string} url
 */
export async function configureRemote(url) {
  writeEnvFile({
    COMFY_MODE: 'remote',
    COMFY_URL: url.replace(/\/$/, ''),
  });
  applyEnv(loadEnvFile(), { overwrite: true });
  const tags = listComponents().find((c) => c.id === 'tags');
  if (tags) {
    try {
      await tags.install({});
    } catch (err) {
      p.log.warn(err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Doctor: status all components + macOS CUDA node warnings.
 */
export async function runDoctor() {
  p.intro('Doctor');
  /** @type {{ comp: import('./types.js').Component, status: import('./types.js').ComponentStatus }[]} */
  const problems = [];
  const lines = [];

  for (const comp of listComponents()) {
    const status = await comp.status();
    lines.push(`${comp.name}: ${formatStatusLine(status)}`);
    if (status.state === 'missing' || status.state === 'broken' || (status.problems && status.problems.length)) {
      problems.push({ comp, status });
    }
  }

  if (process.platform === 'darwin') {
    const cudaNodes = listCudaOnlyInstalledOnMac();
    for (const name of cudaNodes) {
      lines.push(`Custom node ${name}: unsupported on macOS (CUDA)`);
      problems.push({
        comp: {
          id: `cuda-hint:${name}`,
          name: name,
          async status() {
            return { state: 'broken', problems: ['CUDA-only — unsupported on macOS'] };
          },
          async install() {},
          async update() {},
          async repair() {
            p.log.warn(`Remove or disable ${name} on macOS — it needs CUDA.`);
          },
          async reinstall() {},
          async uninstall() {},
        },
        status: { state: 'broken', problems: ['CUDA-only — unsupported on macOS'] },
      });
    }
  }

  p.note(lines.join('\n'), 'Status');

  if (problems.length === 0) {
    p.log.success('No problems found');
    return;
  }

  const choice = await p.select({
    message: 'Repair?',
    options: [
      { value: 'all', label: 'Repair all fixable problems' },
      ...problems.map((x) => ({
        value: x.comp.id,
        label: `${x.comp.name}`,
        hint: formatStatusLine(x.status),
      })),
      { value: '', label: 'Back' },
    ],
  });
  if (handleCancel(choice) || !choice) return;

  const targets =
    choice === 'all' ? problems.map((x) => x.comp) : [problems.find((x) => x.comp.id === choice)?.comp].filter(Boolean);

  for (const comp of targets) {
    if (!comp) continue;
    try {
      p.log.step(`Repairing ${comp.name}…`);
      await comp.repair({});
      p.log.success(`${comp.name} repaired`);
    } catch (err) {
      p.log.error(`${comp.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
