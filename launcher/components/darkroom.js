import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { withOpLog } from '../lib/opLog.js';
import { getGitBin, root } from '../lib/paths.js';
import { runCommand, runNpm } from '../lib/process.js';
import { stopDarkroomServer } from '../lib/server.js';
import {
  readInstalledVersion,
  rollbackOverlay,
  updateFromZip,
  writeInstalledVersion,
} from '../lib/zipUpdate.js';
import { withRestorePoint } from '../lib/restorePoint.js';
import { defaultConfirm } from './types.js';

/**
 * ZIP install update: stop the server we own, overlay the latest release,
 * reinstall deps only if the lockfile changed, roll back on failure.
 * @param {typeof darkroomComponent} comp
 * @param {import('./types.js').ComponentContext} ctx
 * @param {{ info: (m: string) => void }} log
 */
async function updateZipInstall(comp, ctx, log) {
  if (await stopDarkroomServer()) p.log.step('Stopped the Darkroom server for the update…');

  const s = p.spinner();
  s.start('Checking for updates…');
  /** @type {Awaited<ReturnType<typeof updateFromZip>>} */
  let result;
  try {
    result = await updateFromZip({ log, onStep: (m) => s.message(m) });
  } catch (err) {
    s.stop('Update failed — nothing was changed');
    throw err;
  }
  if (!result.updated) {
    s.stop(`Already up to date (${result.sha.slice(0, 7)})`);
    return { restartRequired: false };
  }
  const { change } = result;
  s.stop(
    `Applied update ${result.sha.slice(0, 7)} — ${change.replaced.length} updated, ${change.added.length} added, ${change.deleted.length} removed`,
  );

  if (result.lockChanged) {
    try {
      await comp.install(ctx);
    } catch (err) {
      p.log.error('Dependency install failed — restoring the previous version…');
      const failed = rollbackOverlay(change);
      if (failed.length) p.log.warn(`Could not restore ${failed.length} file(s); copies are in ${change.backupDir}`);
      try {
        await comp.install(ctx);
      } catch {
        p.log.warn('Could not reinstall previous dependencies — run Components → Darkroom → Repair.');
      }
      throw err;
    }
  }

  writeInstalledVersion(result.sha);
  if (change.staged.length) {
    p.log.info('The Windows start file was updated too — it switches over the next time you open it.');
  }
  p.log.info(`Backup of replaced files: ${change.backupDir}`);
  return { restartRequired: true };
}

/** @type {import('./types.js').Component} */
export const darkroomComponent = {
  id: 'darkroom',
  name: 'Darkroom',
  platforms: ['*'],
  gpus: ['*'],

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
    } else {
      gitHash = readInstalledVersion()?.sha?.slice(0, 7) ?? null;
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
      // npm replaces node_modules — Windows can't while a running server has its native module loaded
      if (await stopDarkroomServer()) p.log.step('Stopped the Darkroom server while its files are replaced — start it again afterwards.');
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

  /**
   * git checkout → git pull; ZIP install → overlay the latest GitHub ZIP.
   * @returns {Promise<{ restartRequired: boolean }>}
   */
  async update(ctx = {}) {
    if (fs.existsSync(path.join(root, '.git'))) {
      await withOpLog('darkroom', 'update', async (log) => {
        await withRestorePoint('darkroom', {}, async () => {
          p.log.step('git pull…');
          await runCommand(getGitBin(), ['pull', '--ff-only'], { cwd: root, stdio: 'inherit' });
          await this.install(ctx);
          log.info('Darkroom updated');
        });
      });
      return { restartRequired: true };
    }
    return withOpLog('darkroom', 'update', (log) => updateZipInstall(this, ctx, log));
  },

  async repair(ctx = {}) {
    return this.install(ctx);
  },

  async reinstall(ctx = {}) {
    const confirm = ctx.confirm || defaultConfirm;
    if (await confirm('Delete node_modules and reinstall?', true)) {
      await stopDarkroomServer();
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
      await stopDarkroomServer();
      const nm = path.join(root, 'node_modules');
      if (fs.existsSync(nm)) {
        fs.rmSync(nm, { recursive: true, force: true });
        log.info('Removed node_modules');
      }
    });
  },
};
