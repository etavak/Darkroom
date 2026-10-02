import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sevenBin from '7zip-bin';
import { downloadFile } from './download.js';
import { httpGetJson } from './http.js';
import { loadPins } from './pins.js';
import { ensureLogsDir, logsDir, restorePointsDir, root, runtimeDir } from './paths.js';

/**
 * Update a non-git (ZIP) install by overlaying the latest GitHub ZIP of the repo.
 * User state and installed prerequisites are never touched; every file the
 * update replaces or deletes is backed up and restored if anything fails.
 */

export const versionFile = path.join(runtimeDir, 'darkroom-version.json');
const stagingDir = path.join(runtimeDir, 'update-staging');

/** Top-level entries that belong to the user / installer, never the update. */
const PRESERVED_TOP = new Set([
  '.env',
  '.git',
  'runtime',
  'logs',
  'node_modules',
  'ComfyUI',
  'ComfyUI_windows_portable',
  'models',
  'outputs',
  'output',
]);

/**
 * @param {string} rel posix-style path relative to the Darkroom root
 */
export function isPreserved(rel) {
  const parts = rel.split('/');
  if (PRESERVED_TOP.has(parts[0])) return true;
  if (parts.includes('node_modules') || parts.includes('.git')) return true;
  if (rel.startsWith('server/data/')) return true;
  if (rel === 'server/presets/checkpoints.json') return true; // user family mappings
  if (rel.startsWith('server/tags/') && rel !== 'server/tags/.gitkeep') return true;
  if (rel.startsWith('client/dist/') || rel.startsWith('server/dist/')) return true;
  return false;
}

/** @returns {{ sha: string, updatedAt: string } | null} */
export function readInstalledVersion() {
  try {
    return JSON.parse(fs.readFileSync(versionFile, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Where to fetch from. DARKROOM_UPDATE_ZIP (local path or URL) overrides GitHub for testing.
 * @returns {Promise<{ sha: string, zipUrl: string | null, zipPath: string | null }>}
 */
export async function resolveLatestRelease() {
  const override = process.env.DARKROOM_UPDATE_ZIP;
  if (override) {
    const isUrl = /^https?:\/\//i.test(override);
    const sha = isUrl ? override : `local-${fs.statSync(override).mtimeMs}`;
    return { sha, zipUrl: isUrl ? override : null, zipPath: isUrl ? null : override };
  }
  const pins = loadPins();
  const repo = pins.darkroom?.githubRepo || 'etavak/Darkroom';
  const branch = pins.darkroom?.branch || 'main';
  const res = await httpGetJson(`https://api.github.com/repos/${repo}/commits/${branch}`, {
    headers: { 'User-Agent': 'Darkroom/1.0', Accept: 'application/vnd.github+json' },
  });
  const sha = res.json?.sha;
  if (res.status !== 200 || typeof sha !== 'string') {
    throw new Error(`Could not check GitHub for updates (HTTP ${res.status}). Check your connection.`);
  }
  return { sha, zipUrl: `https://codeload.github.com/${repo}/zip/${sha}`, zipPath: null };
}

/** @returns {Promise<void>} */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`)),
    );
  });
}

/** Bundled 7-Zip first; system unzip as a fallback on macOS / Linux. */
async function extractZip(archive, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  if (process.platform !== 'win32') {
    // npm installs 7zip-bin's mac/linux binary without the execute bit
    try {
      fs.chmodSync(sevenBin.path7za, 0o755);
    } catch {
      // read-only install — fallback below
    }
  }
  try {
    await run(sevenBin.path7za, ['x', archive, `-o${outDir}`, '-y']);
  } catch (err) {
    if (process.platform === 'win32') throw new Error(`Extract failed: ${err instanceof Error ? err.message : err}`);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    await run('unzip', ['-q', '-o', archive, '-d', outDir]);
  }
}

/** GitHub ZIPs wrap everything in one `<repo>-<sha>/` folder. */
function findRepoRoot(dir) {
  const isRepo = (d) =>
    fs.existsSync(path.join(d, 'package.json')) &&
    fs.existsSync(path.join(d, 'scripts', 'cli', 'index.js'));
  if (isRepo(dir)) return dir;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && isRepo(path.join(dir, e.name))) return path.join(dir, e.name);
  }
  throw new Error('Downloaded archive does not look like a Darkroom release');
}

/**
 * @param {string} base
 * @param {(rel: string) => boolean} skip
 * @returns {string[]} posix relative file paths
 */
function listFiles(base, skip) {
  /** @type {string[]} */
  const out = [];
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (skip(rel)) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (e.isFile()) out.push(rel);
    }
  };
  walk(base, '');
  return out;
}

function sameContent(a, b) {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    if (sa.size !== sb.size) return false;
    const h = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
    return h(a) === h(b);
  } catch {
    return false;
  }
}

/**
 * Restore files touched by an overlay from its backup.
 * @param {{ backupDir: string, added: string[], replaced: string[], deleted: string[] }} change
 */
export function rollbackOverlay(change) {
  /** @type {string[]} */
  const failed = [];
  for (const rel of change.added) {
    try {
      fs.rmSync(path.join(root, rel), { force: true });
    } catch {
      failed.push(rel);
    }
  }
  for (const rel of [...change.replaced, ...change.deleted]) {
    const src = path.join(change.backupDir, rel);
    const dest = path.join(root, rel);
    if (!fs.existsSync(src) || sameContent(src, dest)) continue;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    } catch {
      failed.push(rel);
    }
  }
  return failed;
}

/**
 * Copy the new tree over root. Deletes files that vanished upstream, but only inside
 * top-level folders the release ships (never user files at the root).
 * @param {string} newRoot
 * @param {{ info: (m: string) => void }} log
 */
function overlay(newRoot, log) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(restorePointsDir, `${stamp}-darkroom-zip`, 'files');
  const change = {
    backupDir,
    /** @type {string[]} */ added: [],
    /** @type {string[]} */ replaced: [],
    /** @type {string[]} */ deleted: [],
    /** @type {string[]} */ staged: [],
  };
  const backup = (rel) => {
    const dest = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, rel), dest);
  };

  const incoming = listFiles(newRoot, isPreserved);
  const incomingSet = new Set(incoming);
  const shippedTopDirs = new Set(
    fs
      .readdirSync(newRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  );

  try {
    for (const rel of incoming) {
      const src = path.join(newRoot, rel);
      let dest = path.join(root, rel);
      const exists = fs.existsSync(dest);
      if (exists && sameContent(src, dest)) continue;

      // cmd.exe keeps reading a running .bat by byte offset — stage it for the next launch
      if (process.platform === 'win32' && rel === 'Darkroom.bat' && exists) {
        dest = `${dest}.new`;
        fs.copyFileSync(src, dest);
        change.staged.push(`${rel}.new`);
        continue;
      }

      if (exists) {
        backup(rel);
        change.replaced.push(rel);
      } else {
        change.added.push(rel);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      if (/\.(command|sh)$/.test(rel) && process.platform !== 'win32') {
        fs.chmodSync(dest, 0o755);
      }
    }

    // Only files inside folders the release ships; root-level files are left alone
    const existing = listFiles(
      root,
      (rel) => isPreserved(rel) || !shippedTopDirs.has(rel.split('/')[0]),
    );
    for (const rel of existing) {
      if (incomingSet.has(rel)) continue;
      backup(rel);
      fs.rmSync(path.join(root, rel), { force: true });
      change.deleted.push(rel);
    }
  } catch (err) {
    log.info(`overlay failed, rolling back: ${err instanceof Error ? err.message : err}`);
    const failed = rollbackOverlay(change);
    if (failed.length) {
      log.info(`could not restore: ${failed.join(', ')} (copies in ${backupDir})`);
      throw new Error(
        `${err instanceof Error ? err.message : err}\nSome files could not be restored automatically — backups are in ${backupDir}`,
      );
    }
    throw err;
  }

  return change;
}

/**
 * Download + apply the latest release over this install.
 * @param {{ log: { info: (m: string) => void }, onStep?: (m: string) => void }} opts
 * @returns {Promise<{ updated: false, sha: string } | {
 *   updated: true, sha: string, lockChanged: boolean,
 *   change: { backupDir: string, added: string[], replaced: string[], deleted: string[], staged: string[] },
 * }>}
 */
export async function updateFromZip({ log, onStep = () => {} }) {
  onStep('Checking for updates…');
  const latest = await resolveLatestRelease();
  const installed = readInstalledVersion();
  log.info(`installed=${installed?.sha ?? '(unknown)'} latest=${latest.sha}`);
  if (installed?.sha === latest.sha) return { updated: false, sha: latest.sha };

  ensureLogsDir();
  let archive = latest.zipPath;
  if (!archive) {
    archive = path.join(logsDir, 'downloads', `darkroom-${latest.sha.slice(0, 12)}.zip`);
    onStep('Downloading update…');
    log.info(`download ${latest.zipUrl}`);
    await downloadFile(/** @type {string} */ (latest.zipUrl), archive);
  }

  onStep('Extracting…');
  await extractZip(archive, stagingDir);
  const newRoot = findRepoRoot(stagingDir);

  const lockPath = path.join(root, 'package-lock.json');
  const lockBefore = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : '';

  onStep('Applying update…');
  const change = overlay(newRoot, log);
  log.info(
    `added=${change.added.length} replaced=${change.replaced.length} deleted=${change.deleted.length} staged=${change.staged.join(',') || '-'} backup=${change.backupDir}`,
  );

  const lockAfter = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : '';
  fs.rmSync(stagingDir, { recursive: true, force: true });
  if (!latest.zipPath) fs.rmSync(archive, { force: true });

  return { updated: true, sha: latest.sha, lockChanged: lockBefore !== lockAfter, change };
}

/** Record the installed release once the update fully succeeded. */
export function writeInstalledVersion(sha) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    versionFile,
    JSON.stringify({ sha, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
}
