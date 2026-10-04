import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import sevenBin from '7zip-bin';
import { upsertEnvValue } from '../lib/env.js';
import { detectGpu } from '../lib/hardware.js';
import { defaultComfyDir, logsDir, root } from '../lib/paths.js';
import { validateComfyInstall } from './detect.js';

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
          res.on('aborted', () => out.destroy(new Error('The download was cut off — try again.')));
          out.on('finish', () => {
            // a dropped connection can end the stream early; never keep half an archive
            if (total > 0 && transferred !== total) {
              fs.rmSync(tmp, { force: true });
              reject(new Error(`The download was cut off at ${(transferred / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB — try again.`));
              return;
            }
            fs.renameSync(tmp, dest);
            resolve({ bytes: transferred });
          });
          out.on('error', (err) => {
            fs.rmSync(tmp, { force: true });
            reject(err);
          });
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
 * Which of a release's Windows builds fits this PC's graphics card. ComfyUI ships one per GPU
 * family: NVIDIA (newest CUDA), NVIDIA for older cards (CUDA 12.6 — CUDA 13 dropped cards
 * before the RTX 20 series, compute capability 7.5), AMD and Intel. `cpu` means ComfyUI has to
 * be started with --cpu (no usable GPU, or no build for it in this release).
 * @param {{ name: string, browser_download_url?: string, size?: number }[]} assets
 * @param {import('../lib/hardware.js').GpuInfo} gpu
 */
export function pickPortableAsset(assets, gpu) {
  const find = (/** @type {RegExp} */ re) => assets.find((a) => re.test(a.name) && a.browser_download_url);
  const nvidia = find(/windows_portable_nvidia\.7z$/i) || find(/windows.*portable.*(nvidia|cu\d+).*\.7z$/i) || find(/windows_portable.*\.7z$/i);
  if (gpu.vendor === 'nvidia') {
    const older = gpu.computeCap !== null && gpu.computeCap < 7.5 ? find(/windows_portable_nvidia_cu12\d\.7z$/i) : undefined;
    return { asset: older || nvidia, flavour: older ? 'NVIDIA (older cards)' : 'NVIDIA', cpu: false };
  }
  if (gpu.vendor === 'amd') {
    const amd = find(/windows_portable_amd\.7z$/i);
    if (amd) return { asset: amd, flavour: 'AMD', cpu: false };
  }
  if (gpu.vendor === 'intel') {
    const intel = find(/windows_portable_intel\.7z$/i);
    if (intel) return { asset: intel, flavour: 'Intel', cpu: false };
  }
  return { asset: nvidia, flavour: 'NVIDIA (running on the CPU)', cpu: true };
}

/**
 * Resolve latest Windows portable .7z from ComfyUI GitHub releases, for this PC's GPU.
 * @param {import('../lib/hardware.js').GpuInfo} [gpu]
 * @returns {Promise<{ url: string, name: string, tag: string, size: number, flavour: string, cpu: boolean }>}
 */
export async function resolveWindowsPortableAsset(gpu = detectGpu()) {
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
    const { asset, flavour, cpu } = pickPortableAsset(rel.assets || [], gpu);
    if (asset?.browser_download_url) {
      return { url: asset.browser_download_url, name: asset.name, tag: rel.tag_name || rel.name, size: Number(asset.size) || 0, flavour, cpu };
    }
  }
  throw new Error(
    'Could not find a Windows portable .7z on ComfyUI GitHub releases. Install manually, then choose “Use existing”.',
  );
}

/** 7-Zip's exit codes (7-zip.org/faq.html). */
const SEVEN_ZIP_EXIT = { 1: 'warnings', 2: 'fatal error', 7: 'bad command line', 8: 'not enough memory', 255: 'stopped' };

/**
 * A readable reason for a failed extraction, from 7-Zip's exit code and output.
 * `damaged` means the archive itself is bad (delete it so the next try downloads it again);
 * `locked` means another program (usually antivirus) held a file, so a retry tends to work.
 * @param {number | null} code
 * @param {string} output
 */
export function describe7zipFailure(code, output) {
  const errors = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(Open ERROR|ERROR|Can ?not|Unexpected|Data Error|CRC|Headers Error|There are some data|Is not archive)|Sub items Errors/i.test(l));
  const detail = errors.slice(-3).join('\n');
  const damaged = /Data Error|CRC Failed|Unexpected end|Headers Error|Can ?not open the file as archive|Is not archive|There are some data after/i.test(output);
  const locked = /Access is denied|being used by another process|Permission denied/i.test(output);
  const noSpace = /not enough space|No space left/i.test(output);
  let hint = '';
  if (noSpace) hint = 'The drive is full — ComfyUI needs about 5 GB free once unpacked.';
  else if (damaged) hint = 'The downloaded archive is damaged, so Darkroom deleted it — try again to download it fresh.';
  else if (locked) hint = 'Another program (usually antivirus scanning the new files) held a file open. Trying again normally works; adding the Darkroom folder as an antivirus exclusion stops it happening.';
  else if (code === 8) hint = 'Close some programs and try again.';
  const what = SEVEN_ZIP_EXIT[/** @type {keyof typeof SEVEN_ZIP_EXIT} */ (code ?? 0)] ?? `exit ${code}`;
  const message = [`7-Zip couldn't unpack ComfyUI (${what}).`, detail, hint, 'Full 7-Zip output: logs/7zip.log'].filter(Boolean).join('\n');
  return { message, damaged, locked };
}

/**
 * Unpack `archive` into `outDir` with the bundled 7-Zip, reporting percent done.
 * Errors carry `damaged` / `locked` flags (see describe7zipFailure).
 * @param {string} archive
 * @param {string} outDir
 * @param {(percent: number) => void} [onPercent]
 * @param {string} [logFile]
 */
export function extract7z(archive, outDir, onPercent, logFile = path.join(logsDir, '7zip.log')) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const log = fs.createWriteStream(logFile);
    // -bsp1: progress on stdout; -bse1: errors on stdout too, so they stay in order
    const child = spawn(sevenBin.path7za, ['x', archive, `-o${outDir}`, '-y', '-bsp1', '-bso1', '-bse1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let lastPercent = -1;
    const onData = (/** @type {Buffer} */ buf) => {
      // progress redraws itself with backspaces; turn those into line breaks to keep the text readable
      const text = buf.toString('utf8').replaceAll('\b', '\n');
      for (const m of text.matchAll(/(\d{1,3})%/g)) {
        const pct = Number(m[1]);
        if (pct !== lastPercent && pct <= 100) onPercent?.((lastPercent = pct));
      }
      const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^\s*\d{1,3}%/.test(l));
      if (!lines.length) return;
      const chunk = `${lines.join('\n')}\n`;
      log.write(chunk);
      output = (output + chunk).slice(-20_000);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      log.end();
      reject(err);
    });
    child.on('close', (code) =>
      // settle once the log is flushed, so it's complete when the error points to it
      log.end(() => {
        if (code === 0) return resolve(undefined);
        const { message, damaged, locked } = describe7zipFailure(code, output);
        reject(Object.assign(new Error(message), { damaged, locked }));
      }),
    );
  });
}

/** Free bytes on the drive holding `dir`, or null when it can't be read. */
function freeBytes(dir) {
  try {
    const st = fs.statfsSync(dir);
    return st.bavail * st.bsize;
  } catch {
    return null;
  }
}

/**
 * Rename a folder to `<name>.old-<date>-<n>` so something new can take its place, without
 * deleting anything. Windows refuses while a program is using the folder (its current
 * directory, an open file) — that becomes a clear error and the folder is left as it was.
 * @param {string} dir
 * @returns {string} where it went
 */
export function moveAside(dir) {
  const aside = `${dir}.old-${new Date().toISOString().slice(0, 10)}-${Date.now() % 100000}`;
  try {
    fs.renameSync(dir, aside);
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code ?? 'error';
    throw new Error(
      `Couldn't move ${path.basename(dir)} out of the way (${code}): a program is using that folder — ComfyUI itself, a terminal or window open in it, or antivirus. Close it and try again. Nothing was deleted.`,
    );
  }
  return aside;
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
    : defaultComfyDir();
  p.log.info(`Install location: ${destParent}`);

  const gpu = detectGpu();
  const s = p.spinner();
  s.start('Looking up latest ComfyUI Windows portable release…');
  let asset;
  try {
    asset = await resolveWindowsPortableAsset(gpu);
    s.stop(`Found ${asset.name} (${asset.tag}) — the ${asset.flavour} build${gpu.name ? ` for ${gpu.name}` : ''}`);
  } catch (err) {
    s.stop('Release lookup failed');
    throw err;
  }

  const cacheDir = path.join(root, 'logs', 'downloads');
  fs.mkdirSync(cacheDir, { recursive: true });
  const archive = path.join(cacheDir, asset.name);

  // a cached archive of the wrong size is a leftover from a broken download
  const cachedSize = fs.existsSync(archive) ? fs.statSync(archive).size : 0;
  if (cachedSize && (asset.size ? cachedSize !== asset.size : cachedSize < 1_000_000)) fs.rmSync(archive, { force: true });

  if (!fs.existsSync(archive)) {
    p.log.info('Downloading portable archive (large — several GB)…');
    await downloadWithProgress(asset.url, archive, progressLine);
    process.stdout.write('\n');
  } else {
    p.log.info('Using cached archive');
  }

  // unpack next to the destination: same drive (so the final move is instant) and a short
  // path, since some files inside sit ~185 characters deep
  fs.mkdirSync(path.dirname(destParent), { recursive: true });
  const extractTo = path.join(path.dirname(destParent), '.comfy-unpack');
  const unpacked = Math.max(asset.size || fs.statSync(archive).size, 1) * 2.3;
  const free = freeBytes(path.dirname(destParent));
  if (free !== null && free < unpacked) {
    throw new Error(`Not enough disk space to unpack ComfyUI: it needs about ${(unpacked / 1e9).toFixed(1)} GB, ${(free / 1e9).toFixed(1)} GB is free.`);
  }

  for (let attempt = 1; ; attempt++) {
    s.start('Extracting with 7-Zip (thousands of files — a few minutes)…');
    fs.rmSync(extractTo, { recursive: true, force: true });
    try {
      await extract7z(archive, extractTo, (pct) => s.message(`Extracting with 7-Zip… ${pct}%`));
      s.stop('Extracted');
      break;
    } catch (err) {
      const e = /** @type {Error & { damaged?: boolean, locked?: boolean }} */ (err);
      // antivirus often holds a freshly written file for a moment — one quiet retry usually gets past it
      if (e.locked && attempt === 1) {
        s.stop('A file was busy — trying the extraction again');
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      s.stop('Extract failed');
      fs.rmSync(extractTo, { recursive: true, force: true });
      if (e.damaged) fs.rmSync(archive, { force: true });
      throw err;
    }
  }

  const found = findPortableRoot(extractTo);
  if (!found) throw new Error('Extracted archive but could not locate ComfyUI + python_embeded');

  // Never delete an existing ComfyUI: its models, custom nodes and settings live inside it
  if (fs.existsSync(destParent)) {
    let aside;
    try {
      aside = moveAside(destParent);
    } catch (err) {
      fs.rmSync(extractTo, { recursive: true, force: true });
      throw err;
    }
    p.log.warn(`Your previous ComfyUI (with its models and custom nodes) was kept at ${aside}. Move anything you need from it, then delete it.`);
  }
  fs.renameSync(found.comfyDir, destParent);
  fs.rmSync(extractTo, { recursive: true, force: true });

  const validated = validateComfyInstall(destParent);
  if (!validated) throw new Error('Install finished but validation failed');
  // No usable GPU: ComfyUI's GPU builds stop at start-up unless told to use the CPU
  upsertEnvValue('COMFY_FORCE_CPU', asset.cpu ? 'true' : 'false');
  if (asset.cpu) p.log.warn('No supported graphics card found — ComfyUI will run on the CPU, which is slow.');
  return validated;
}
