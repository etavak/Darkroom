import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { downloadFile } from '../lib/download.js';
import { withOpLog } from '../lib/opLog.js';
import { loadPins } from '../lib/pins.js';
import { ensureRuntimeDirs, getGitBin, runtimeGitDir } from '../lib/paths.js';
import { runCommand } from '../lib/process.js';
import { withRestorePoint } from '../lib/restorePoint.js';
import { defaultConfirm } from './types.js';

function gitVersion(bin = getGitBin()) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const m = r.stdout.match(/git version\s+([\d.]+)/i);
  return m ? m[1] : r.stdout.trim();
}

function isPortableGit() {
  const bin = getGitBin();
  return typeof bin === 'string' && bin.includes(`${path.sep}runtime${path.sep}git`);
}

/**
 * Poll until `git --version` works or timeout.
 * @param {number} timeoutMs
 * @param {(msg: string) => void} [onTick]
 */
export async function waitForGit(timeoutMs = 15 * 60_000, onTick) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (gitVersion('git') || gitVersion()) return true;
    onTick?.('Waiting for git to become available…');
    await new Promise((r) => setTimeout(r, 3000));
  }
  return Boolean(gitVersion('git') || gitVersion());
}

async function installMinGit(log) {
  if (process.platform !== 'win32') {
    throw new Error('MinGit install is Windows-only');
  }
  ensureRuntimeDirs();
  const pins = loadPins();
  const url = pins.mingit?.url;
  if (!url) throw new Error('mingit.url missing from components.json');
  const zip = path.join(runtimeGitDir, 'mingit.zip');
  log?.info(`Downloading ${url}`);
  p.log.info('Downloading MinGit…');
  await downloadFile(url, zip);

  for (const e of fs.readdirSync(runtimeGitDir, { withFileTypes: true })) {
    if (e.name === 'mingit.zip') continue;
    fs.rmSync(path.join(runtimeGitDir, e.name), { recursive: true, force: true });
  }

  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zip.replace(/'/g, "''")}' -DestinationPath '${runtimeGitDir.replace(/'/g, "''")}' -Force`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (ps.status !== 0) throw new Error(ps.stderr || 'MinGit extract failed');
  fs.rmSync(zip, { force: true });

  if (!fs.existsSync(path.join(runtimeGitDir, 'cmd', 'git.exe'))) {
    const kids = fs.readdirSync(runtimeGitDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const k of kids) {
      const nested = path.join(runtimeGitDir, k.name);
      if (fs.existsSync(path.join(nested, 'cmd', 'git.exe'))) {
        for (const f of fs.readdirSync(nested)) {
          fs.renameSync(path.join(nested, f), path.join(runtimeGitDir, f));
        }
        fs.rmSync(nested, { recursive: true, force: true });
        break;
      }
    }
  }

  if (!gitVersion()) throw new Error('MinGit installed but git.exe not found');
  log?.info(`Git ready: ${getGitBin()}`);
}

/** @type {import('./types.js').Component} */
export const gitComponent = {
  id: 'git',
  name: 'Git',
  platforms: ['*'],
  gpus: ['*'],

  async status() {
    const ver = gitVersion();
    if (ver) {
      return {
        state: 'installed',
        version: ver,
        detail: isPortableGit() ? 'portable runtime/git' : 'system',
      };
    }
    if (process.platform === 'darwin') {
      return {
        state: 'missing',
        problems: ['Git not found — install Xcode Command Line Tools'],
        detail: 'xcode-select --install',
      };
    }
    if (process.platform === 'win32') {
      return { state: 'missing', problems: ['Git not found — MinGit can be installed into runtime/git'] };
    }
    return { state: 'missing', problems: ['Git not found on PATH'] };
  },

  async install() {
    await withOpLog('git', 'install', async (log) => {
      if (gitVersion()) {
        log.info('Git already available');
        return;
      }
      if (process.platform === 'win32') {
        await installMinGit(log);
        return;
      }
      if (process.platform === 'darwin') {
        p.note(
          [
            'macOS needs the Xcode Command Line Tools for git.',
            'A system dialog should appear — click Install and wait.',
            'Darkroom will wait until git is available, then continue.',
          ].join('\n'),
          'Xcode Command Line Tools',
        );
        log.warn('Invoking xcode-select --install');
        try {
          await runCommand('xcode-select', ['--install'], { stdio: 'inherit' });
        } catch {
          // Dialog may already be open / tools partially installed
          p.log.info('If no dialog appeared, run manually: xcode-select --install');
        }

        const s = p.spinner();
        s.start('Waiting for git (finish the CLT installer if prompted)…');
        const ok = await waitForGit(20 * 60_000, (msg) => {
          s.message(msg);
          log.info(msg);
        });
        if (!ok) {
          s.stop('Timed out waiting for git');
          throw new Error(
            'git still not available. Finish installing Xcode Command Line Tools, then retry.',
          );
        }
        s.stop(`Git ready (${gitVersion()})`);
        log.info(`Git ready: ${gitVersion()}`);
        return;
      }
      throw new Error('Install git via your package manager (e.g. apt install git), then retry.');
    });
  },

  async update() {
    if (process.platform === 'win32' && isPortableGit()) {
      await withOpLog('git', 'update', async (log) => {
        await withRestorePoint('git', {}, async () => {
          await installMinGit(log);
        });
      });
      return;
    }
    p.log.info('System git updates are managed by the OS / package manager.');
  },

  async repair(ctx = {}) {
    return this.install(ctx);
  },

  async reinstall(ctx = {}) {
    if (process.platform === 'win32') {
      await this.uninstall(ctx);
    }
    await this.install(ctx);
  },

  async uninstall(ctx = {}) {
    if (process.platform !== 'win32') {
      p.log.info('System git is not removed by Darkroom.');
      return;
    }
    const confirm = ctx.confirm || defaultConfirm;
    if (!(await confirm('Remove portable MinGit from runtime/git/?', true))) return;
    await withOpLog('git', 'uninstall', async (log) => {
      if (fs.existsSync(runtimeGitDir)) {
        for (const e of fs.readdirSync(runtimeGitDir)) {
          fs.rmSync(path.join(runtimeGitDir, e), { recursive: true, force: true });
        }
        log.info('Removed runtime/git contents');
      }
    });
  },
};
