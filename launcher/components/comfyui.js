import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { loadAndApplyEnv, applyEnv, loadEnvFile } from '../lib/env.js';
import { comfyStoppedFor } from '../lib/comfy.js';
import { accelInstallNote, isIntelMac } from '../lib/hardware.js';
import { withOpLog } from '../lib/opLog.js';
import { loadPins } from '../lib/pins.js';
import {
  getComfyPortableRoot,
  getComfyPython,
  getComfyUiRoot,
  getGitBin,
  defaultComfyDir,
  getModelsRoot,
} from '../lib/paths.js';
import { runCommand } from '../lib/process.js';
import { withRestorePoint } from '../lib/restorePoint.js';
import { validateComfyInstall } from '../setup/detect.js';
import { installComfyWindowsPortable } from '../setup/installComfy.js';
import { writeEnvFile } from '../setup/writeEnv.js';
import { getManagedPython } from './python.js';
import { defaultConfirm } from './types.js';

function defaultDest() {
  return defaultComfyDir();
}

function persistLocalEnv(validated, port = 8188) {
  const envVars = {
    COMFY_MODE: 'local',
    COMFY_URL: `http://127.0.0.1:${port}`,
    COMFY_DIR: validated.comfyDir,
    COMFY_PYTHON: validated.python,
  };
  writeEnvFile(envVars);
  applyEnv(loadEnvFile(), { overwrite: true });
  return envVars;
}

/**
 * @param {string} dest
 * @param {import('./types.js').ComponentContext} ctx
 * @param {{ info: (m: string) => void }} log
 */
async function installUnixSource(dest, ctx, log) {
  const pins = loadPins();
  const repo = pins.comfyui?.repo || 'https://github.com/comfyanonymous/ComfyUI.git';
  const ref = ctx.channel === 'latest' ? 'master' : pins.comfyui?.testedRef || 'master';
  const git = getGitBin();

  p.note(accelInstallNote(), 'Hardware');
  if (isIntelMac()) {
    const ok = await (ctx.confirm || defaultConfirm)(
      'This is an Intel Mac. Generation will be CPU-only and very slow. Continue installing ComfyUI?',
      false,
    );
    if (!ok) throw new Error('Install cancelled (Intel Mac CPU warning)');
  }

  const python = getManagedPython();
  if (!python) {
    throw new Error('Python 3.12 not ready — install the Python component (uv) first');
  }
  log.info(`Using Python: ${python}`);

  if (fs.existsSync(path.join(dest, '.git'))) {
    p.log.info('Existing git clone — updating…');
    await runCommand(git, ['pull', '--ff-only'], { cwd: dest, stdio: 'inherit' });
  } else if (fs.existsSync(dest) && fs.existsSync(path.join(dest, 'main.py'))) {
    p.log.info('Existing ComfyUI folder (no .git) — reusing');
  } else if (fs.existsSync(dest)) {
    throw new Error(`${dest} exists but is not a ComfyUI checkout`);
  } else {
    p.log.step('Cloning ComfyUI…');
    await runCommand(git, ['clone', '--depth', '1', '--branch', ref, repo, dest], {
      stdio: 'inherit',
    }).catch(async () => {
      // branch may not exist as named ref on shallow — clone default then checkout
      await runCommand(git, ['clone', '--depth', '1', repo, dest], { stdio: 'inherit' });
    });
  }

  const venvDir = path.join(dest, 'venv');
  const venvPython = path.join(venvDir, 'bin', 'python');
  if (!fs.existsSync(venvPython)) {
    p.log.step('Creating venv…');
    if (fs.existsSync(venvDir)) fs.rmSync(venvDir, { recursive: true, force: true });
    await runCommand(python, ['-m', 'venv', 'venv'], { cwd: dest, stdio: 'inherit' });
  }

  p.log.step('Upgrading pip…');
  await runCommand(
    venvPython,
    ['-s', '-m', 'pip', 'install', '--upgrade', '--retries', '10', '--timeout', '60', 'pip', 'wheel', 'setuptools'],
    { cwd: dest, stdio: 'inherit' },
  );

  p.log.step('Installing ComfyUI requirements…');
  await runCommand(
    venvPython,
    ['-s', '-m', 'pip', 'install', '--retries', '10', '--timeout', '60', '-r', 'requirements.txt'],
    { cwd: dest, stdio: 'inherit' },
  );

  const validated = validateComfyInstall(dest);
  if (!validated) throw new Error('ComfyUI install finished but validation failed');
  persistLocalEnv(validated);
  log.info(`ComfyUI ready at ${validated.comfyDir}`);
}

/**
 * Run the Windows portable's own updater: pulls ComfyUI (to the newest release with --stable),
 * then installs its requirements. Mirrors update\update_comfyui(_stable).bat, including the
 * updater replacing itself and running again.
 * @param {string} portable ComfyUI_windows_portable folder
 * @param {string} python its python_embeded\python.exe
 * @param {boolean} stable newest release rather than the newest commit
 */
export async function runPortableUpdater(portable, python, stable) {
  const updateDir = path.join(portable, 'update');
  const comfyArg = `..${path.sep}ComfyUI${path.sep}`;
  const run = (/** @type {string[]} */ extra) =>
    runCommand(python, ['update.py', comfyArg, ...extra, ...(stable ? ['--stable'] : [])], { cwd: updateDir, stdio: 'inherit' });
  p.log.step(stable ? 'Updating ComfyUI to its newest release…' : 'Updating ComfyUI to the newest version…');
  await run([]);
  const fresh = path.join(updateDir, 'update_new.py');
  if (fs.existsSync(fresh)) {
    fs.renameSync(fresh, path.join(updateDir, 'update.py'));
    p.log.info('The updater updated itself — running it again');
    await run(['--skip_self_update']);
  }
  // update.py ignores a failed requirements install; run it here too so a failure shows
  p.log.step('Checking ComfyUI requirements…');
  await runCommand(python, ['-s', '-m', 'pip', 'install', '-r', path.join(portable, 'ComfyUI', 'requirements.txt')], {
    cwd: portable,
    stdio: 'inherit',
  });
}

/**
 * git, with a clear message when it isn't installed (Windows has none until Darkroom adds MinGit).
 * @param {string[]} args
 * @param {string} cwd
 */
async function runGit(args, cwd) {
  try {
    await runCommand(getGitBin(), args, { cwd, stdio: 'inherit' });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      throw new Error('Git is needed for this — install it from Components → Git, then try again.');
    }
    throw err;
  }
}

/**
 * Move a folder's contents into another (renames — same drive), the moved files winning over
 * same-named ones (a fresh ComfyUI's models/ holds only placeholder files). Removes `src` when done.
 * @param {string} src
 * @param {string} dst
 */
export function mergeInto(src, dst) {
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return;
  }
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name);
    const to = path.join(dst, e.name);
    const toIsDir = fs.existsSync(to) && fs.statSync(to).isDirectory();
    if (e.isDirectory() && toIsDir) mergeInto(from, to);
    // a file where the new install has a folder of that name: keep both
    else fs.renameSync(from, toIsDir ? `${to}.kept` : to);
  }
  fs.rmdirSync(src);
}

/** @type {import('./types.js').Component} */
export const comfyuiComponent = {
  id: 'comfyui',
  name: 'ComfyUI',
  platforms: ['*'],
  gpus: ['*'],

  async status() {
    loadAndApplyEnv();
    const dir = process.env.COMFY_DIR || '';
    if (!dir) {
      return { state: 'missing', problems: ['COMFY_DIR not set'] };
    }
    if (!fs.existsSync(dir)) {
      return { state: 'broken', problems: [`COMFY_DIR missing on disk: ${dir}`] };
    }
    const validated = validateComfyInstall(dir);
    if (!validated) {
      return { state: 'broken', detail: dir, problems: ['Could not validate ComfyUI install'] };
    }
    const ui = getComfyUiRoot(dir);
    let version = validated.kind;
    if (ui && fs.existsSync(path.join(ui, '.git'))) {
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync(getGitBin(), ['rev-parse', '--short', 'HEAD'], {
        cwd: ui,
        encoding: 'utf8',
        windowsHide: true,
      });
      if (r.status === 0) version = r.stdout.trim();
    }
    return {
      state: 'installed',
      version,
      detail: `${validated.kind} · ${validated.comfyDir}`,
    };
  },

  async install(ctx = {}) {
    await withOpLog('comfyui', 'install', async (log) => {
      const dest = ctx.installDir || defaultDest();
      if (process.platform === 'win32') {
        p.log.info('Windows: installing ComfyUI portable build…');
        const validated = await installComfyWindowsPortable({ dest });
        persistLocalEnv(validated);
        log.info(`Portable ready at ${validated.comfyDir}`);
        return;
      }
      await installUnixSource(dest, ctx, log);
    });
  },

  async update(ctx = {}) {
    await withOpLog('comfyui', 'update', async (log) => {
      loadAndApplyEnv();
      const dir = process.env.COMFY_DIR;
      if (!dir) throw new Error('COMFY_DIR not set');
      const ui = getComfyUiRoot(dir);
      if (!ui) throw new Error('Invalid COMFY_DIR');

      const portable = getComfyPortableRoot(dir) || dir;
      const embedded = path.join(portable, 'python_embeded', 'python.exe');
      if (fs.existsSync(embedded) && fs.existsSync(path.join(portable, 'update', 'update.py'))) {
        // The Windows portable build: in place, with the updater it ships (what its
        // update_comfyui.bat runs) — models, custom nodes and their packages stay as they are
        await comfyStoppedFor(ctx, defaultConfirm, () =>
          withRestorePoint('comfyui', { comfyDir: ui }, async () => {
            await runPortableUpdater(portable, embedded, ctx.channel !== 'latest');
            log.info('ComfyUI updated');
          }),
        );
        return;
      }
      if (!fs.existsSync(path.join(ui, '.git'))) {
        throw new Error(
          fs.existsSync(embedded)
            ? `This ComfyUI (${dir}) has no update\\update.py to update itself with. Use Reinstall instead.`
            : 'ComfyUI is not a git checkout — use Reinstall',
        );
      }
      // A git checkout with its own venv (macOS, Linux, or set up by hand on Windows)
      await comfyStoppedFor(ctx, defaultConfirm, () =>
        withRestorePoint('comfyui', { comfyDir: ui }, async () => {
          await runGit(['pull', '--ff-only'], ui);
          await runCommand(getComfyPython(dir), ['-s', '-m', 'pip', 'install', '-r', 'requirements.txt'], {
            cwd: ui,
            stdio: 'inherit',
          });
          log.info('ComfyUI updated');
        }),
      );
    });
  },

  async repair(ctx = {}) {
    const st = await this.status();
    if (st.state === 'missing') return this.install(ctx);
    loadAndApplyEnv();
    const dir = process.env.COMFY_DIR;
    const ui = getComfyUiRoot(dir);
    const py = getComfyPython(dir);
    if (ui && py && fs.existsSync(py)) {
      // Reinstall ComfyUI's requirements — the portable's Python or the venv alike
      await withOpLog('comfyui', 'repair', async (log) => {
        await comfyStoppedFor(ctx, defaultConfirm, () =>
          runCommand(py, ['-s', '-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: ui, stdio: 'inherit' }),
        );
        log.info('Reinstalled requirements');
      });
      return;
    }
    return this.reinstall(ctx);
  },

  async reinstall(ctx = {}) {
    const kept = /** @type {{ rel: string, kept: string }[] | undefined} */ (await this.uninstall({ ...ctx, skipModelConfirm: false }));
    await this.install(ctx);
    // Put the kept models / outputs into the new ComfyUI
    const ui = getComfyUiRoot(process.env.COMFY_DIR || '');
    for (const k of kept ?? []) {
      if (!ui) break;
      try {
        mergeInto(k.kept, path.join(ui, k.rel));
        p.log.success(`Moved your ${k.rel} into the new ComfyUI`);
      } catch (err) {
        p.log.warn(`Your ${k.rel} are still at ${k.kept} — move them into ${path.join(ui, k.rel)} yourself (${err instanceof Error ? err.message : err}).`);
      }
    }
    for (const k of kept ?? []) {
      const parent = path.dirname(k.kept);
      if (fs.existsSync(parent) && !fs.readdirSync(parent).length) fs.rmdirSync(parent);
    }
  },

  async uninstall(ctx = {}) {
    loadAndApplyEnv();
    const dir = process.env.COMFY_DIR;
    if (!dir || !fs.existsSync(dir)) {
      p.log.info('No ComfyUI install to remove');
      return;
    }
    const confirm = ctx.confirm || defaultConfirm;
    if (!(await confirm(`Remove ComfyUI install at ${dir}?`, false))) return;

    const models = getModelsRoot(dir);
    const ui = getComfyUiRoot(dir);
    const sensitive = [];
    for (const rel of ['models', 'output', 'outputs']) {
      const pth = ui ? path.join(ui, rel) : path.join(dir, rel);
      if (fs.existsSync(pth)) sensitive.push(pth);
    }
    if (models && fs.existsSync(models) && !sensitive.includes(models)) sensitive.push(models);

    let wipeModels = false;
    if (sensitive.length) {
      wipeModels = await confirm(
        'Also delete models/ and output folders? (requires explicit yes)',
        false,
      );
    }

    /** @type {{ rel: string, kept: string }[]} */
    const kept = [];
    await withOpLog('comfyui', 'uninstall', async (log) => {
      // Windows can't delete a folder ComfyUI is running from
      await comfyStoppedFor(ctx, defaultConfirm, async () => {
        if (!wipeModels && sensitive.length) {
          // Next to the ComfyUI folder: same drive, so it's a rename (a move to another drive fails)
          const keepParent = path.join(path.dirname(path.resolve(dir)), `${path.basename(dir)}-kept-${new Date().toISOString().slice(0, 10)}-${Date.now() % 100000}`);
          fs.mkdirSync(keepParent, { recursive: true });
          for (const s of sensitive) {
            const dest = path.join(keepParent, path.basename(s));
            try {
              fs.renameSync(s, dest);
            } catch (err) {
              // Never delete what couldn't be kept: put back what moved, and stop
              for (const k of kept) fs.renameSync(k.kept, path.join(ui || dir, k.rel));
              fs.rmSync(keepParent, { recursive: true, force: true });
              throw new Error(`Couldn't keep ${s} aside (${/** @type {NodeJS.ErrnoException} */ (err).code ?? err}) — nothing was removed. Close any program using it and try again.`);
            }
            kept.push({ rel: path.basename(s), kept: dest });
            log.info(`Preserved ${s} → ${dest}`);
          }
          p.log.info(`Kept your ${kept.map((k) => k.rel).join(' and ')} at ${keepParent}`);
        }
        fs.rmSync(dir, { recursive: true, force: true });
      });
      log.info(`Removed ${dir}`);
    });
    return kept;
  },
};
