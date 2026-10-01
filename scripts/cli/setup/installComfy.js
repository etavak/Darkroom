import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import * as p from '@clack/prompts';
import sevenBin from '7zip-bin';
import { root } from '../lib/paths.js';
import { runCommand } from '../lib/process.js';
import {
  getPythonVersionTuple,
  validateComfyInstall,
} from './detect.js';
import { ensurePreferredPython, isPreferredPythonVersion } from './ensurePython.js';
import { handleCancel } from '../lib/prompt.js';

/**
 * @param {string} url
 * @param {string} dest
 * @param {(transferred: number, total: number) => void} [onProgress]
 */
function downloadWithProgress(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.partial`;

    const go = (current, redirects = 0) => {
      if (redirects > 12) {
        reject(new Error('Too many redirects'));
        return;
      }
      const lib = current.startsWith('https') ? https : http;
      const req = lib.get(
        current,
        { headers: { 'User-Agent': 'Darkroom/1.0', Accept: '*/*' }, timeout: 120_000 },
        (res) => {
          const code = res.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
            res.resume();
            go(new URL(res.headers.location, current).toString(), redirects + 1);
            return;
          }
          if (code < 200 || code >= 300) {
            res.resume();
            reject(new Error(`Download failed HTTP ${code}`));
            return;
          }
          const total = Number(res.headers['content-length'] || 0);
          let transferred = 0;
          const out = fs.createWriteStream(tmp);
          res.on('data', (chunk) => {
            transferred += chunk.length;
            onProgress?.(transferred, total);
          });
          res.pipe(out);
          out.on('finish', () => {
            fs.renameSync(tmp, dest);
            resolve({ bytes: transferred });
          });
          out.on('error', reject);
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Download timed out'));
      });
    };
    go(url);
  });
}

function progressLine(transferred, total) {
  const width = 28;
  const pct = total > 0 ? Math.min(100, (transferred / total) * 100) : 0;
  const filled = total > 0 ? Math.round((pct / 100) * width) : 0;
  const bar = `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
  const mb = (transferred / 1e6).toFixed(1);
  const totalMb = total > 0 ? (total / 1e6).toFixed(1) : '?';
  process.stdout.write(
    `\r  ${bar} ${total > 0 ? pct.toFixed(1) : '?'}%  ${mb}/${totalMb} MB`,
  );
}

/**
 * Resolve latest Windows portable .7z from ComfyUI GitHub releases.
 * @returns {Promise<{ url: string, name: string, tag: string }>}
 */
export async function resolveWindowsPortableAsset() {
  const api =
    'https://api.github.com/repos/comfyanonymous/ComfyUI/releases?per_page=15';
  const res = await fetch(api, {
    headers: {
      'User-Agent': 'Darkroom/1.0',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`GitHub releases API failed (${res.status})`);
  /** @type {any[]} */
  const releases = await res.json();
  for (const rel of releases) {
    const assets = rel.assets || [];
    const asset =
      assets.find((a) => /windows.*portable.*\.7z$/i.test(a.name) && /nvidia|cu\d+/i.test(a.name)) ||
      assets.find((a) => /ComfyUI_windows_portable.*\.7z$/i.test(a.name)) ||
      assets.find((a) => /windows_portable.*\.7z$/i.test(a.name));
    if (asset?.browser_download_url) {
      return { url: asset.browser_download_url, name: asset.name, tag: rel.tag_name || rel.name };
    }
  }
  throw new Error(
    'Could not find a Windows portable .7z on ComfyUI GitHub releases. Install manually, then choose “Use existing”.',
  );
}

function extract7z(archive, outDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outDir, { recursive: true });
    const seven = sevenBin.path7za;
    const child = spawn(seven, ['x', archive, `-o${outDir}`, '-y'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`7z extract failed (exit ${code})`));
    });
  });
}

/**
 * Find extracted portable root (folder with python_embeded).
 * @param {string} extractRoot
 */
function findPortableRoot(extractRoot) {
  const direct = validateComfyInstall(extractRoot);
  if (direct) return direct;

  const entries = fs.readdirSync(extractRoot, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = validateComfyInstall(path.join(extractRoot, e.name));
    if (hit) return hit;
  }
  // one more level
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(extractRoot, e.name);
    for (const e2 of fs.readdirSync(sub, { withFileTypes: true })) {
      if (!e2.isDirectory()) continue;
      const hit = validateComfyInstall(path.join(sub, e2.name));
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * @param {{ dest?: string }} [opts]
 * @returns {Promise<import('./detect.js').DetectedComfy>}
 */
export async function installComfyWindowsPortable(opts = {}) {
  const destParent = opts.dest
    ? path.resolve(opts.dest)
    : path.join(root, 'ComfyUI_windows_portable');
  p.log.info(`Install location: ${destParent}`);

  const s = p.spinner();
  s.start('Looking up latest ComfyUI Windows portable release…');
  let asset;
  try {
    asset = await resolveWindowsPortableAsset();
    s.stop(`Found ${asset.name} (${asset.tag})`);
  } catch (err) {
    s.stop('Release lookup failed');
    throw err;
  }

  const cacheDir = path.join(root, 'logs', 'downloads');
  fs.mkdirSync(cacheDir, { recursive: true });
  const archive = path.join(cacheDir, asset.name);

  if (!fs.existsSync(archive) || fs.statSync(archive).size < 1_000_000) {
    p.log.info('Downloading portable archive (large — several GB)…');
    await downloadWithProgress(asset.url, archive, progressLine);
    process.stdout.write('\n');
  } else {
    p.log.info('Using cached archive');
  }

  s.start('Extracting with 7-Zip…');
  const extractTo = path.join(cacheDir, 'portable-extract');
  fs.rmSync(extractTo, { recursive: true, force: true });
  try {
    await extract7z(archive, extractTo);
    s.stop('Extracted');
  } catch (err) {
    s.stop('Extract failed');
    throw err;
  }

  const found = findPortableRoot(extractTo);
  if (!found) throw new Error('Extracted archive but could not locate ComfyUI + python_embeded');

  fs.mkdirSync(path.dirname(destParent), { recursive: true });
  if (fs.existsSync(destParent)) {
    fs.rmSync(destParent, { recursive: true, force: true });
  }
  fs.renameSync(found.comfyDir, destParent);

  const validated = validateComfyInstall(destParent);
  if (!validated) throw new Error('Install finished but validation failed');
  return validated;
}

/**
 * @param {string} pip
 * @param {string[]} pkgs
 * @param {{ cwd: string, extraArgs?: string[] }} opts
 */
async function pipInstall(pip, pkgs, opts) {
  const base = [
    '-m',
    'pip',
    'install',
    '--upgrade',
    '--retries',
    '10',
    '--timeout',
    '60',
    ...(opts.extraArgs || []),
    ...pkgs,
  ];
  try {
    await runCommand(pip, base, { cwd: opts.cwd, stdio: 'inherit' });
    return;
  } catch {
    // Common on flaky networks / captive portals — retry with trusted hosts.
    p.log.warn('pip failed — retrying with --trusted-host (PyPI)…');
    await runCommand(
      pip,
      [
        '-m',
        'pip',
        'install',
        '--upgrade',
        '--retries',
        '10',
        '--timeout',
        '60',
        '--trusted-host',
        'pypi.org',
        '--trusted-host',
        'files.pythonhosted.org',
        '--trusted-host',
        'download.pytorch.org',
        ...(opts.extraArgs || []),
        ...pkgs,
      ],
      { cwd: opts.cwd, stdio: 'inherit' },
    );
  }
}

/**
 * @param {string} venvPython
 * @param {string} basePython
 * @param {[number, number]} baseVersion
 */
function venvNeedsRecreate(venvPython, basePython, baseVersion) {
  if (!fs.existsSync(venvPython)) return true;
  const ver = getPythonVersionTuple(venvPython);
  if (!ver) return true;
  if (ver[0] !== baseVersion[0] || ver[1] !== baseVersion[1]) return true;
  const probe = spawnSync(venvPython, ['-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  if (probe.status !== 0) return true;
  void basePython;
  return false;
}

/**
 * @param {{ cuda?: boolean, dest?: string, _retriedPythonFix?: boolean }} [opts]
 * @returns {Promise<import('./detect.js').DetectedComfy>}
 */
export async function installComfyFromSource(opts = {}) {
  const dest = opts.dest ? path.resolve(opts.dest) : path.join(root, 'ComfyUI');

  let info = await ensurePreferredPython();

  if (!info) {
    throw new Error(
      'Python 3.10–3.13 is required for a reliable ComfyUI install. Install Python 3.12, then retry.',
    );
  }

  const { executable: python, version } = info;
  p.log.info(`Install location: ${dest}`);
  p.log.info(`Using Python: ${python} (${version[0]}.${version[1]})`);
  if (!isPreferredPythonVersion(version)) {
    p.log.warn(
      `Python ${version[0]}.${version[1]} is not preferred — installs may fail. Prefer 3.12/3.13.`,
    );
  }

  if (fs.existsSync(path.join(dest, '.git'))) {
    p.log.info('Existing git clone found — updating…');
    await runCommand('git', ['pull', '--ff-only'], { cwd: dest, stdio: 'inherit' });
  } else if (fs.existsSync(dest)) {
    throw new Error(`${dest} exists but is not a git clone. Move it aside or choose “Use existing”.`);
  } else {
    p.log.step('Cloning ComfyUI…');
    await runCommand(
      'git',
      ['clone', '--depth', '1', 'https://github.com/comfyanonymous/ComfyUI.git', dest],
      { stdio: 'inherit' },
    );
  }

  const venvDir = path.join(dest, 'venv');
  const venvPython =
    process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python');

  const recreateVenv = async () => {
    if (fs.existsSync(venvDir)) {
      p.log.step('Recreating venv…');
      fs.rmSync(venvDir, { recursive: true, force: true });
    } else {
      p.log.step('Creating venv…');
    }
    await runCommand(python, ['-m', 'venv', 'venv'], { cwd: dest, stdio: 'inherit' });
  };

  if (venvNeedsRecreate(venvPython, python, version)) {
    await recreateVenv();
  }

  try {
    const pip = venvPython;
    p.log.step('Upgrading pip…');
    await pipInstall(pip, ['pip', 'wheel', 'setuptools'], { cwd: dest });

    const useCuda = opts.cuda === true && process.platform === 'linux';
    if (useCuda) {
      p.log.step('Installing PyTorch (CUDA 12.4 index)…');
      await pipInstall(pip, ['torch', 'torchvision', 'torchaudio'], {
        cwd: dest,
        extraArgs: ['--index-url', 'https://download.pytorch.org/whl/cu124'],
      });
    } else {
      p.log.step(
        process.platform === 'darwin'
          ? 'Installing PyTorch (macOS / MPS)…'
          : 'Installing PyTorch…',
      );
      await pipInstall(pip, ['torch', 'torchvision', 'torchaudio'], { cwd: dest });
    }

    p.log.step('Installing ComfyUI requirements…');
    await pipInstall(pip, ['-r', 'requirements.txt'], { cwd: dest });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts._retriedPythonFix) {
      throw new Error(
        `${msg}\n\nPyPI install still failed after switching Python. Check your network and try again.`,
      );
    }

    p.log.error(msg);

    if (!isPreferredPythonVersion(version)) {
      const fixed = await ensurePreferredPython({
        forceOffer: true,
        reason:
          'Dependency install failed — often caused by Python 3.14 or a flaky PyPI connection. Install Python 3.12 and retry with a fresh venv?',
      });
      if (fixed && isPreferredPythonVersion(fixed.version)) {
        if (fs.existsSync(venvDir)) {
          fs.rmSync(venvDir, { recursive: true, force: true });
        }
        return installComfyFromSource({ ...opts, _retriedPythonFix: true });
      }
    }

    const cont = await p.confirm({
      message: 'Retry dependency install?',
      initialValue: true,
    });
    if (handleCancel(cont) || !cont) throw err;

    if (fs.existsSync(venvDir)) {
      fs.rmSync(venvDir, { recursive: true, force: true });
    }
    return installComfyFromSource({ ...opts, _retriedPythonFix: true });
  }

  const validated = validateComfyInstall(dest);
  if (!validated) throw new Error('Install finished but validation failed');
  return validated;
}
