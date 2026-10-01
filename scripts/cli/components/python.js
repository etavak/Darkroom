import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { downloadFile } from '../lib/download.js';
import { getConfig } from '../lib/env.js';
import { withOpLog } from '../lib/opLog.js';
import { loadPins } from '../lib/pins.js';
import {
  ensureRuntimeDirs,
  getComfyPython,
  getUvBin,
  runtimeUvDir,
} from '../lib/paths.js';
import { runCommand } from '../lib/process.js';
import { withRestorePoint } from '../lib/restorePoint.js';
import { defaultConfirm } from './types.js';

function uvPlatformAsset() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (process.platform === 'darwin') return `uv-${arch}-apple-darwin.tar.gz`;
  if (process.platform === 'linux') return `uv-${arch}-unknown-linux-gnu.tar.gz`;
  if (process.platform === 'win32') return `uv-x86_64-pc-windows-msvc.zip`;
  return null;
}

async function installUv(channel, log) {
  ensureRuntimeDirs();
  const pins = loadPins();
  let version = pins.uv?.tested || '0.6.14';
  const repo = pins.uv?.githubRepo || 'astral-sh/uv';

  if (channel === 'latest') {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { 'User-Agent': 'Darkroom/1.0', Accept: 'application/vnd.github+json' },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.tag_name) version = String(json.tag_name).replace(/^v/, '');
      }
    } catch {
      log?.warn('Could not resolve latest uv — using tested pin');
    }
  }

  const asset = uvPlatformAsset();
  if (!asset) throw new Error(`Unsupported platform for uv: ${process.platform}`);
  const url = `https://github.com/${repo}/releases/download/${version.startsWith('v') ? version : `v${version}`}/${asset}`;
  const archive = path.join(runtimeUvDir, asset);
  log?.info(`Downloading ${url}`);
  p.log.info(`Downloading uv ${version}…`);
  await downloadFile(url, archive);

  for (const e of fs.readdirSync(runtimeUvDir)) {
    if (e === path.basename(archive)) continue;
    fs.rmSync(path.join(runtimeUvDir, e), { recursive: true, force: true });
  }

  if (asset.endsWith('.zip')) {
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${archive.replace(/'/g, "''")}' -DestinationPath '${runtimeUvDir.replace(/'/g, "''")}' -Force`,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    if (ps.status !== 0) throw new Error(ps.stderr || 'uv extract failed');
  } else {
    await runCommand('tar', ['-xzf', archive, '-C', runtimeUvDir], { stdio: 'inherit' });
    // tarball may nest uv in a folder
    const nested = fs
      .readdirSync(runtimeUvDir, { withFileTypes: true })
      .find((d) => d.isDirectory() && fs.existsSync(path.join(runtimeUvDir, d.name, 'uv')));
    if (nested) {
      fs.renameSync(path.join(runtimeUvDir, nested.name, 'uv'), path.join(runtimeUvDir, 'uv'));
      fs.rmSync(path.join(runtimeUvDir, nested.name), { recursive: true, force: true });
    }
  }
  fs.rmSync(archive, { force: true });

  const bin = getUvBin();
  if (!bin) throw new Error('uv binary not found after install');
  // chmod on unix
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  log?.info(`uv ready: ${bin}`);
}

function listUvPythons() {
  const uv = getUvBin();
  if (!uv) return [];
  const r = spawnSync(uv, ['python', 'list', '--only-installed'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function findUvPython312() {
  const lines = listUvPythons();
  const hit = lines.find((l) => /\b3\.12\b/.test(l));
  if (!hit) return null;
  // uv list lines often end with path
  const parts = hit.split(/\s+/);
  const maybePath = parts[parts.length - 1];
  if (maybePath && fs.existsSync(maybePath)) return maybePath;
  // fallback: uv python find
  const uv = getUvBin();
  const find = spawnSync(uv, ['python', 'find', '3.12'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (find.status === 0 && find.stdout.trim() && fs.existsSync(find.stdout.trim())) {
    return find.stdout.trim();
  }
  return hit;
}

export function getManagedPython() {
  if (process.platform === 'win32') {
    const cfg = getConfig();
    if (!cfg.comfyDir) return null;
    const py = getComfyPython(cfg.comfyDir);
    return fs.existsSync(py) ? py : null;
  }
  return findUvPython312();
}

/** @type {import('./types.js').Component} */
export const pythonComponent = {
  id: 'python',
  name: 'Python',

  async status() {
    const pins = loadPins();
    const tested = pins.python?.tested || '3.12';

    if (process.platform === 'win32') {
      const py = getManagedPython();
      if (py) {
        const ver = spawnSync(py, ['-c', 'import sys; print(".".join(map(str, sys.version_info[:3])))'], {
          encoding: 'utf8',
          windowsHide: true,
        });
        return {
          state: 'installed',
          version: ver.status === 0 ? ver.stdout.trim() : 'embedded',
          testedVersion: tested,
          detail: 'ComfyUI portable embedded',
        };
      }
      return {
        state: 'missing',
        testedVersion: tested,
        detail: 'satisfied by ComfyUI portable after install',
        problems: ['ComfyUI portable Python not found yet'],
      };
    }

    const uv = getUvBin();
    if (!uv) {
      return { state: 'missing', testedVersion: tested, problems: ['uv not installed in runtime/uv'] };
    }
    const py = findUvPython312();
    if (!py) {
      return {
        state: 'broken',
        testedVersion: tested,
        detail: 'uv present',
        problems: ['Python 3.12 not installed via uv'],
      };
    }
    return {
      state: 'installed',
      version: '3.12',
      testedVersion: tested,
      detail: py,
    };
  },

  async install(ctx = {}) {
    await withOpLog('python', 'install', async (log) => {
      if (process.platform === 'win32') {
        log.info('Windows uses ComfyUI portable embedded Python — install ComfyUI component');
        p.log.info('On Windows, Python comes with the ComfyUI portable install.');
        return;
      }
      if (!getUvBin()) {
        await installUv(ctx.channel || 'tested', log);
      }
      const uv = getUvBin();
      if (!uv) throw new Error('uv missing after install');
      const pins = loadPins();
      const ver = pins.python?.tested || '3.12';
      p.log.step(`Installing Python ${ver} via uv…`);
      await runCommand(uv, ['python', 'install', ver], { stdio: 'inherit' });
      const py = findUvPython312();
      if (!py) throw new Error('uv python install finished but 3.12 not found');
      log.info(`Python ready: ${py}`);
    });
  },

  async update(ctx = {}) {
    if (process.platform === 'win32') {
      p.log.info('Update ComfyUI portable to refresh embedded Python.');
      return;
    }
    await withOpLog('python', 'update', async (log) => {
      await withRestorePoint('python', {}, async () => {
        await installUv(ctx.channel || 'tested', log);
        const uv = getUvBin();
        const ver = loadPins().python?.tested || '3.12';
        await runCommand(uv, ['python', 'install', ver], { stdio: 'inherit' });
      });
    });
  },

  async repair(ctx = {}) {
    return this.install(ctx);
  },

  async reinstall(ctx = {}) {
    if (process.platform !== 'win32') {
      await this.uninstall({ ...ctx, confirm: async () => true });
    }
    await this.install(ctx);
  },

  async uninstall(ctx = {}) {
    if (process.platform === 'win32') {
      p.log.info('Embedded Python is removed with the ComfyUI portable uninstall.');
      return;
    }
    const confirm = ctx.confirm || defaultConfirm;
    if (!(await confirm('Remove uv (and leave uv-managed Pythons)?', false))) return;
    await withOpLog('python', 'uninstall', async (log) => {
      if (fs.existsSync(runtimeUvDir)) {
        for (const e of fs.readdirSync(runtimeUvDir)) {
          fs.rmSync(path.join(runtimeUvDir, e), { recursive: true, force: true });
        }
        log.info('Removed runtime/uv');
      }
    });
  },
};
