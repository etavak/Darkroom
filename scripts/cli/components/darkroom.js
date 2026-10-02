import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { withOpLog } from '../lib/opLog.js';
import { getGitBin, root } from '../lib/paths.js';
import { runCommand, runNpm } from '../lib/process.js';
import { withRestorePoint } from '../lib/restorePoint.js';
import { defaultConfirm } from './types.js';

/** @type {import('./types.js').Component} */
export const darkroomComponent = {
  id: 'darkroom',
  name: 'Darkroom',

  async status() {
    const pkg = path.join(root, 'package.json');
    if (!fs.existsSync(pkg)) {
      return { state: 'broken', problems: ['package.json missing'] };
    }
    const version = JSON.parse(fs.readFileSync(pkg, 'utf8')).version || '?';
    const hasModules = fs.existsSync(path.join(root, 'node_modules', '@clack', 'prompts'));
    let gitHash = null;
    if (fs.existsSync(path.join(root, '.git'))) {
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync(getGitBin(), ['rev-parse', '--short', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      });
      if (r.status === 0) gitHash = r.stdout.trim();
    }
    /** @type {string[]} */
    const problems = [];
    if (!hasModules) problems.push('node_modules incomplete — run npm ci');
    return {
      state: problems.length ? 'broken' : 'installed',
      version: gitHash ? `${version} (${gitHash})` : version,
      detail: root,
      problems: problems.length ? problems : undefined,
    };
  },

  async install() {
    await withOpLog('darkroom', 'install', async (log) => {
      // Always use the same Node/npm as this CLI process (portable 22), never PATH npm.
      const hasLock = fs.existsSync(path.join(root, 'package-lock.json'));
      p.log.step(hasLock ? 'npm ci…' : 'npm install…');
      const npmEnv = { ...process.env, npm_config_engine_strict: 'false' };
      try {
        await runNpm(hasLock ? ['ci'] : ['install'], {
          cwd: root,
          stdio: 'inherit',
          env: npmEnv,
        });
      } catch {
        await runNpm(['install'], { cwd: root, stdio: 'inherit', env: npmEnv });
      }
      // npm may fetch prebuilds for the wrong ABI if PATH is polluted; force local rebuild.
      p.log.step('Rebuilding native modules…');
      await runNpm(['rebuild', 'better-sqlite3'], { cwd: root, stdio: 'inherit' });
      log.info(`node=${process.execPath} (${process.version})`);
    });
  },

  async update(ctx = {}) {
    await withOpLog('darkroom', 'update', async (log) => {
      await withRestorePoint('darkroom', {}, async () => {
        if (fs.existsSync(path.join(root, '.git'))) {
          p.log.step('git pull…');
          await runCommand(getGitBin(), ['pull', '--ff-only'], { cwd: root, stdio: 'inherit' });
        } else {
          p.log.warn('Not a git checkout — skipping pull');
        }
        await this.install(ctx);
        log.info('Darkroom updated');
      });
    });
  },

  async repair(ctx = {}) {
    return this.install(ctx);
  },

  async reinstall(ctx = {}) {
    const confirm = ctx.confirm || defaultConfirm;
    if (await confirm('Delete node_modules and reinstall?', true)) {
      const nm = path.join(root, 'node_modules');
      if (fs.existsSync(nm)) fs.rmSync(nm, { recursive: true, force: true });
    }
    await this.install(ctx);
  },

  async uninstall(ctx = {}) {
    p.log.warn('Uninstalling Darkroom itself is not supported from inside the app.');
    const confirm = ctx.confirm || defaultConfirm;
    if (!(await confirm('Delete node_modules only? (does not delete the repo or database)', false))) {
      return;
    }
    await withOpLog('darkroom', 'uninstall', async (log) => {
      const nm = path.join(root, 'node_modules');
      if (fs.existsSync(nm)) {
        fs.rmSync(nm, { recursive: true, force: true });
        log.info('Removed node_modules');
      }
    });
  },
};
