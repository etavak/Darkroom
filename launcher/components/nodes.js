import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { loadAndApplyEnv } from '../lib/env.js';
import { withOpLog } from '../lib/opLog.js';
import { loadPins } from '../lib/pins.js';
import {
  getComfyPython,
  getComfyUiRoot,
  getCustomNodesDir,
  getGitBin,
} from '../lib/paths.js';
import { comfyStoppedFor } from '../lib/comfy.js';
import { runCommand } from '../lib/process.js';
import { withRestorePoint } from '../lib/restorePoint.js';
import { defaultConfirm } from './types.js';

/**
 * @param {string} id
 * @param {{
 *   name: string,
 *   repo: string,
 *   dir: string,
 *   testedRef?: string,
 *   requiresCuda?: boolean,
 *   platforms?: import('./types.js').PlatformId[],
 *   gpus?: import('./types.js').GpuProfile[],
 * }} meta
 * @returns {import('./types.js').Component}
 */
export function createNodeComponent(id, meta) {
  return {
    id: `node:${id}`,
    name: meta.name,
    optional: true,
    platforms: meta.platforms?.length ? meta.platforms : ['*'],
    gpus: meta.requiresCuda ? ['nvidia'] : meta.gpus?.length ? meta.gpus : ['*'],

    async status() {
      loadAndApplyEnv();
      const custom = getCustomNodesDir(process.env.COMFY_DIR || '');
      if (!custom) {
        return { state: 'missing', problems: ['ComfyUI not configured'] };
      }
      const dest = path.join(custom, meta.dir);
      /** @type {string[]} */
      const problems = [];
      if (process.platform === 'darwin' && meta.requiresCuda) {
        problems.push('Requires CUDA — unsupported on macOS');
      }
      if (!fs.existsSync(dest)) {
        return {
          state: 'missing',
          problems: problems.length ? problems : undefined,
          detail: meta.requiresCuda ? 'CUDA node' : undefined,
        };
      }
      let version = 'installed';
      if (fs.existsSync(path.join(dest, '.git'))) {
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(getGitBin(), ['rev-parse', '--short', 'HEAD'], {
          cwd: dest,
          encoding: 'utf8',
          windowsHide: true,
        });
        if (r.status === 0) version = r.stdout.trim();
      }
      return {
        state: problems.length ? 'broken' : 'installed',
        version,
        detail: dest,
        problems: problems.length ? problems : undefined,
      };
    },

    async install(ctx = {}) {
      await withOpLog(`node:${id}`, 'install', async (log) => {
        if (process.platform === 'darwin' && meta.requiresCuda) {
          p.log.warn(`${meta.name} needs CUDA and is unsupported on macOS.`);
          const ok = await (ctx.confirm || defaultConfirm)('Install anyway?', false);
          if (!ok) throw new Error('Skipped CUDA-only node on macOS');
        }
        loadAndApplyEnv();
        const custom = getCustomNodesDir(process.env.COMFY_DIR || '');
        const ui = getComfyUiRoot(process.env.COMFY_DIR || '');
        if (!custom || !ui) throw new Error('Install ComfyUI first');
        fs.mkdirSync(custom, { recursive: true });
        const dest = path.join(custom, meta.dir);
        if (fs.existsSync(dest)) {
          log.info('already installed');
          return;
        }
        const ref = meta.testedRef;
        const git = getGitBin();
        await comfyStoppedFor(ctx, defaultConfirm, async () => {
          const args = ['clone', '--depth', '1'];
          if (ref && ctx.channel !== 'latest') args.push('--branch', ref);
          args.push(meta.repo, dest);
          try {
            await runCommand(git, args, { cwd: custom, stdio: 'inherit' });
          } catch {
            await runCommand(git, ['clone', '--depth', '1', meta.repo, dest], {
              cwd: custom,
              stdio: 'inherit',
            });
          }
          await installNodeRequirements(dest);
        });
        log.info(`Installed ${meta.dir}`);
      });
    },

    async update(ctx = {}) {
      await withOpLog(`node:${id}`, 'update', async (log) => {
        loadAndApplyEnv();
        const custom = getCustomNodesDir(process.env.COMFY_DIR || '');
        const dest = custom ? path.join(custom, meta.dir) : null;
        if (!dest || !fs.existsSync(dest)) {
          await this.install(ctx);
          return;
        }
        await comfyStoppedFor(ctx, defaultConfirm, () =>
          withRestorePoint(`node:${id}`, { comfyDir: dest }, async () => {
            await runCommand(getGitBin(), ['pull', '--ff-only'], { cwd: dest, stdio: 'inherit' });
            // a pull can add requirements
            await installNodeRequirements(dest);
            log.info('pulled');
          }),
        );
      });
    },

    async repair(ctx = {}) {
      return this.reinstall(ctx);
    },

    async reinstall(ctx = {}) {
      // ComfyUI stopped once for both steps
      await comfyStoppedFor(ctx, defaultConfirm, async () => {
        await this.uninstall({ ...ctx, confirm: async () => true, comfyStopped: true });
        await this.install({ ...ctx, comfyStopped: true });
      });
    },

    async uninstall(ctx = {}) {
      const confirm = ctx.confirm || defaultConfirm;
      if (!(await confirm(`Remove custom node ${meta.name}?`, false))) return;
      await withOpLog(`node:${id}`, 'uninstall', async (log) => {
        loadAndApplyEnv();
        const custom = getCustomNodesDir(process.env.COMFY_DIR || '');
        const dest = custom ? path.join(custom, meta.dir) : null;
        if (dest && fs.existsSync(dest)) {
          // Windows can't delete files of a node ComfyUI has loaded
          await comfyStoppedFor(ctx, defaultConfirm, async () => fs.rmSync(dest, { recursive: true, force: true }));
          log.info(`Removed ${dest}`);
        }
      });
    },
  };
}

/**
 * A custom node's Python packages and install script, into ComfyUI's Python. `-s` keeps pip
 * from counting packages in the user's own Python folder, which ComfyUI (started with -s on
 * the Windows portable) can't see.
 * @param {string} dest
 */
async function installNodeRequirements(dest) {
  const python = getComfyPython(process.env.COMFY_DIR || '');
  const req = path.join(dest, 'requirements.txt');
  if (fs.existsSync(req)) {
    await runCommand(python, ['-s', '-m', 'pip', 'install', '-r', req], { cwd: dest, stdio: 'inherit' });
  }
  const installPy = path.join(dest, 'install.py');
  if (fs.existsSync(installPy)) {
    await runCommand(python, ['-s', installPy], { cwd: dest, stdio: 'inherit' });
  }
}

/** @returns {import('./types.js').Component[]} */
export function createAllNodeComponents() {
  const nodes = loadPins().nodes || {};
  return Object.entries(nodes).map(([id, meta]) =>
    createNodeComponent(id, /** @type {any} */ (meta)),
  );
}

/**
 * Scan custom_nodes for dirs known to need CUDA (Doctor on macOS).
 * @returns {string[]}
 */
export function listCudaOnlyInstalledOnMac() {
  if (process.platform !== 'darwin') return [];
  loadAndApplyEnv();
  const custom = getCustomNodesDir(process.env.COMFY_DIR || '');
  if (!custom || !fs.existsSync(custom)) return [];
  const hints = loadPins().cudaOnlyNodeHints || [];
  return fs
    .readdirSync(custom, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => hints.some((h) => name.toLowerCase().includes(String(h).toLowerCase())));
}
