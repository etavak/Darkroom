import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { downloadFile } from '../lib/download.js';
import { withOpLog } from '../lib/opLog.js';
import { loadPins } from '../lib/pins.js';
import {
  ensureRuntimeDirs,
  getPortableNodeBin,
  listPortableNodes,
  runtimeNodeDir,
} from '../lib/paths.js';
import { withRestorePoint } from '../lib/restorePoint.js';
import { defaultConfirm } from './types.js';

function platformArch() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'win32') return { plat: 'win', arch, ext: 'zip' };
  if (process.platform === 'darwin') return { plat: 'darwin', arch, ext: 'tar.gz' };
  return { plat: 'linux', arch, ext: 'tar.gz' };
}

function versionOf(bin) {
  const r = spawnSync(bin, ['-p', 'process.versions.node'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function majorOf(ver) {
  return Number(String(ver).split('.')[0]);
}

async function extractArchive(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (archive.endsWith('.zip')) {
    if (process.platform === 'win32') {
      await new Promise((resolve, reject) => {
        const ps = spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Path '${archive.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
          ],
          { encoding: 'utf8', windowsHide: true },
        );
        if (ps.status === 0) resolve();
        else reject(new Error(ps.stderr || 'Expand-Archive failed'));
      });
    } else {
      const { runCommand } = await import('../lib/process.js');
      await runCommand('unzip', ['-o', archive, '-d', destDir], { stdio: 'inherit' });
    }
  } else {
    const { runCommand } = await import('../lib/process.js');
    await runCommand('tar', ['-xzf', archive, '-C', destDir], { stdio: 'inherit' });
  }
}

/** Listed folders the start file removes before it runs Node (see removeNodeDirs). */
const removeListPath = () => path.join(runtimeNodeDir, '.remove');

/** The portable Node folder this launcher is running from, if it runs from one. */
function runningNodeDir() {
  const rel = path.relative(runtimeNodeDir, process.execPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return path.join(runtimeNodeDir, rel.split(path.sep)[0]);
}

/**
 * Delete portable Node folders. Windows locks the node.exe this launcher runs from, and
 * deleting its folder would empty everything around it (npm included) before failing — so
 * that one is listed for the start file to remove the next time, before anything runs.
 * @param {string[]} dirs
 * @returns {boolean} whether a folder was left for the next start
 */
function removeNodeDirs(dirs) {
  const running = runningNodeDir();
  const later = [];
  for (const dir of dirs) {
    if (process.platform === 'win32' && running && path.resolve(dir) === path.resolve(running)) later.push(path.basename(dir));
    else fs.rmSync(dir, { recursive: true, force: true });
  }
  if (later.length) fs.appendFileSync(removeListPath(), later.map((n) => `${n}\r\n`).join(''), 'utf8');
  return later.length > 0;
}

/**
 * The Node version to install: the tested pin, or for "latest" the newest release of the same
 * major — the start files only run that major (better-sqlite3 is built for it).
 * @param {'tested' | 'latest'} channel
 * @param {{ warn: (m: string) => void } | undefined} log
 */
async function targetNodeVersion(channel, log) {
  const pinned = loadPins().node?.tested || '22.14.0';
  if (channel !== 'latest') return pinned;
  const major = pinned.split('.')[0];
  try {
    const res = await fetch('https://nodejs.org/dist/index.json', { headers: { 'User-Agent': 'Darkroom/1.0' } });
    if (res.ok) {
      /** @type {{ version: string }[]} */
      const list = await res.json();
      const newest = list.find((e) => String(e.version).startsWith(`v${major}.`));
      if (newest) return newest.version.replace(/^v/, '');
    }
  } catch {
    // fall through
  }
  log?.warn(`Could not look up the newest Node ${major} — using the tested version`);
  return pinned;
}

async function installPortableNode(channel, log) {
  ensureRuntimeDirs();
  const pins = loadPins();
  const version = await targetNodeVersion(channel, log);
  const { plat, arch, ext } = platformArch();
  const name = `node-v${version}-${plat}-${arch}`;
  const targetDir = path.join(runtimeNodeDir, name);

  if (listPortableNodes().some((n) => n.dir === targetDir)) {
    p.log.info(`Node ${version} is already installed.`);
  } else {
    const url = `${pins.node?.distBase || 'https://nodejs.org/dist'}/v${version}/${name}.${ext}`;
    const archive = path.join(runtimeNodeDir, `${name}.${ext}`);
    log?.info(`Downloading ${url}`);
    p.log.info(`Downloading Node ${version}…`);
    await downloadFile(url, archive);
    log?.info('Extracting…');
    await extractArchive(archive, runtimeNodeDir);
    fs.rmSync(archive, { force: true });
    if (!fs.existsSync(targetDir)) throw new Error('Portable Node install finished but its folder is missing');
  }

  // Older versions go — once the new one is in place
  const older = fs
    .readdirSync(runtimeNodeDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('node-v') && e.name !== name)
    .map((e) => path.join(runtimeNodeDir, e.name));
  if (removeNodeDirs(older)) {
    p.log.info('The previous Node is in use by this window — it is removed the next time you open Darkroom.');
  }
  log?.info(`Installed ${targetDir}`);
}

/** @type {import('./types.js').Component} */
export const nodeComponent = {
  id: 'node',
  name: 'Node.js',
  platforms: ['*'],
  gpus: ['*'],

  async status() {
    const pins = loadPins();
    const tested = pins.node?.tested || null;
    const portable = getPortableNodeBin();
    const system = process.execPath;
    const sysVer = versionOf(system);
    const portVer = portable ? versionOf(portable) : null;

    if (sysVer && majorOf(sysVer) >= 22) {
      return {
        state: 'installed',
        version: sysVer,
        testedVersion: tested,
        detail: 'system',
      };
    }

    if (portVer && majorOf(portVer) >= 22) {
      return {
        state: tested && portVer !== tested ? 'update_available' : 'installed',
        version: portVer,
        testedVersion: tested,
        detail: 'portable runtime/node',
      };
    }

    if (sysVer || portVer) {
      return {
        state: 'broken',
        version: sysVer || portVer,
        testedVersion: tested,
        problems: [`Node ${(sysVer || portVer)} is below 22`],
      };
    }

    return { state: 'missing', testedVersion: tested, problems: ['Node.js 22+ not found'] };
  },

  async install(ctx = {}) {
    await withOpLog('node', 'install', async (log) => {
      await installPortableNode(ctx.channel || 'tested', log);
    });
  },

  async update(ctx = {}) {
    await withOpLog('node', 'update', async (log) => {
      await withRestorePoint('node', {}, async () => {
        await installPortableNode(ctx.channel || 'tested', log);
      });
    });
  },

  async repair(ctx = {}) {
    return this.install(ctx);
  },

  async reinstall(ctx = {}) {
    // Windows: this window's own Node can't be replaced while it runs — the start file
    // downloads a fresh copy next time instead
    if (process.platform === 'win32' && runningNodeDir()) {
      const confirm = ctx.confirm || defaultConfirm;
      if (!(await confirm('Reinstall the portable Node? It is downloaded fresh the next time you open Darkroom.', true))) return;
      await withOpLog('node', 'reinstall', async (log) => {
        removeNodeDirs(listPortableNodes().map((n) => n.dir));
        log.info('Listed for removal at the next start');
      });
      p.log.info('Close this window and open "Start Darkroom (Windows).bat" again to finish.');
      return;
    }
    await this.uninstall(ctx);
    await this.install(ctx);
  },

  async uninstall(ctx = {}) {
    const confirm = ctx.confirm || defaultConfirm;
    if (!(await confirm('Remove portable Node from runtime/node/? (system Node is left alone)', true))) {
      return;
    }
    await withOpLog('node', 'uninstall', async (log) => {
      if (!fs.existsSync(runtimeNodeDir)) return;
      const dirs = fs
        .readdirSync(runtimeNodeDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(runtimeNodeDir, e.name));
      if (removeNodeDirs(dirs)) p.log.info('The Node this window runs from is removed the next time you open Darkroom.');
      log.info('Removed runtime/node contents');
    });
  },
};
