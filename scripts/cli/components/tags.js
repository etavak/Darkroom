import fs from 'node:fs';
import path from 'node:path';
import { downloadFile } from '../lib/download.js';
import { withOpLog } from '../lib/opLog.js';
import { loadPins } from '../lib/pins.js';
import { tagsDir } from '../lib/paths.js';
import { defaultConfirm } from './types.js';

/** @type {import('./types.js').Component} */
export const tagsComponent = {
  id: 'tags',
  name: 'Tag CSVs',
  optional: true,

  async status() {
    const files = loadPins().tags?.files || [];
    fs.mkdirSync(tagsDir, { recursive: true });
    const missing = files.filter((f) => {
      const dest = path.join(tagsDir, f.name);
      return !fs.existsSync(dest) || fs.statSync(dest).size < 1000;
    });
    if (missing.length === files.length) {
      return { state: 'missing', problems: missing.map((f) => f.name) };
    }
    if (missing.length) {
      return {
        state: 'broken',
        version: `${files.length - missing.length}/${files.length}`,
        problems: missing.map((f) => f.name),
      };
    }
    return { state: 'installed', version: `${files.length} files`, detail: tagsDir };
  },

  async install() {
    await withOpLog('tags', 'install', async (log) => {
      fs.mkdirSync(tagsDir, { recursive: true });
      for (const f of loadPins().tags?.files || []) {
        const dest = path.join(tagsDir, f.name);
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
    return this.install(ctx);
  },

  async uninstall(ctx = {}) {
    const confirm = ctx.confirm || defaultConfirm;
    if (!(await confirm('Delete tag CSV dictionaries in server/tags/?', false))) return;
    await withOpLog('tags', 'uninstall', async (log) => {
      for (const f of loadPins().tags?.files || []) {
        const dest = path.join(tagsDir, f.name);
        if (fs.existsSync(dest)) {
          fs.rmSync(dest, { force: true });
          log.info(`Removed ${f.name}`);
        }
      }
    });
  },
};
