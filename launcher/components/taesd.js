import fs from 'node:fs';
import path from 'node:path';
import { loadAndApplyEnv } from '../lib/env.js';
import { withOpLog } from '../lib/opLog.js';
import { loadPins } from '../lib/pins.js';
import { getModelsRoot } from '../lib/paths.js';
import { downloadFile } from '../lib/download.js';
import { defaultConfirm } from './types.js';

/** @type {import('./types.js').Component} */
export const taesdComponent = {
  id: 'taesd',
  name: 'TAESD previews',
  optional: true,
  platforms: ['*'],
  gpus: ['*'],

  async status() {
    loadAndApplyEnv();
    const models = getModelsRoot(process.env.COMFY_DIR || '');
    if (!models) {
      return { state: 'missing', problems: ['No local models folder (need ComfyUI)'] };
    }
    const dir = path.join(models, 'vae_approx');
    const pins = loadPins();
    const files = pins.taesd?.files || [];
    const missing = [];
    for (const f of files) {
      const dest = path.join(dir, f.name);
      if (!fs.existsSync(dest) || fs.statSync(dest).size < 10_000) missing.push(f.name);
    }
    if (missing.length === files.length) {
      return { state: 'missing', problems: missing };
    }
    if (missing.length) {
      return { state: 'broken', version: `${files.length - missing.length}/${files.length}`, problems: missing };
    }
    return { state: 'installed', version: `${files.length} files`, detail: dir };
  },

  async install() {
    await withOpLog('taesd', 'install', async (log) => {
      loadAndApplyEnv();
      const models = getModelsRoot(process.env.COMFY_DIR || '');
      if (!models) throw new Error('Install ComfyUI first');
      const dir = path.join(models, 'vae_approx');
      fs.mkdirSync(dir, { recursive: true });
      const files = loadPins().taesd?.files || [];
      for (const f of files) {
        const dest = path.join(dir, f.name);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 10_000) {
          log.info(`exists ${f.name}`);
          continue;
        }
        log.info(`download ${f.name}`);
        await downloadFile(f.url, dest);
      }
    });
  },

  async update(ctx = {}) {
    return this.install(ctx);
  },

  async repair(ctx = {}) {
    return this.install(ctx);
  },

  async reinstall(ctx = {}) {
    loadAndApplyEnv();
    const models = getModelsRoot(process.env.COMFY_DIR || '');
    if (models) {
      const dir = path.join(models, 'vae_approx');
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    await this.install(ctx);
  },

  async uninstall(ctx = {}) {
    const confirm = ctx.confirm || defaultConfirm;
    if (!(await confirm('Remove TAESD decoder files from models/vae_approx/?', false))) return;
    await withOpLog('taesd', 'uninstall', async (log) => {
      loadAndApplyEnv();
      const models = getModelsRoot(process.env.COMFY_DIR || '');
      const dir = models ? path.join(models, 'vae_approx') : null;
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        log.info(`Removed ${dir}`);
      }
    });
  },
};
