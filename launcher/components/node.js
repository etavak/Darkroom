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

async function installPortableNode(channel, log) {
  ensureRuntimeDirs();
  const pins = loadPins();
  let version = pins.node?.tested || '22.14.0';
  if (channel === 'latest') {
    try {
      const res = await fetch('https://nodejs.org/dist/index.json', {
        headers: { 'User-Agent': 'Darkroom/1.0' },
      });
      if (res.ok) {
        /** @type {any[]} */
        const list = await res.json();
        const lts = list.find((e) => e.lts);
        if (lts?.version) version = String(lts.version).replace(/^v/, '');
      }
    } catch {
      log?.warn('Could not resolve latest Node LTS — using tested pin');
    }
  }

  const { plat, arch, ext } = platformArch();
  const name = `node-v${version}-${plat}-${arch}`;
  const url = `${pins.node?.distBase || 'https://nodejs.org/dist'}/v${version}/${name}.${ext}`;
  const archive = path.join(runtimeNodeDir, `${name}.${ext}`);

  // Remove older portable installs
  for (const e of fs.readdirSync(runtimeNodeDir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.startsWith('node-v')) {
      fs.rmSync(path.join(runtimeNodeDir, e.name), { recursive: true, force: true });
    }
  }

  log?.info(`Downloading ${url}`);
  p.log.info(`Downloading Node ${version}…`);
  await downloadFile(url, archive);
  log?.info('Extracting…');
  await extractArchive(archive, runtimeNodeDir);
  fs.rmSync(archive, { force: true });

  const bin = getPortableNodeBin();
  if (!bin) throw new Error('Portable Node install finished but binary not found');
  log?.info(`Installed ${bin}`);
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
    await this.uninstall(ctx);
    await this.install(ctx);
  },

  async uninstall(ctx = {}) {
    const confirm = ctx.confirm || defaultConfirm;
    if (!(await confirm('Remove portable Node from runtime/node/? (system Node is left alone)', true))) {
      return;
    }
    await withOpLog('node', 'uninstall', async (log) => {
      if (fs.existsSync(runtimeNodeDir)) {
        for (const e of fs.readdirSync(runtimeNodeDir, { withFileTypes: true })) {
          fs.rmSync(path.join(runtimeNodeDir, e.name), { recursive: true, force: true });
        }
        log.info('Removed runtime/node contents');
      }
    });
  },
};
