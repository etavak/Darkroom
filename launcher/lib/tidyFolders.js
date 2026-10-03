import fs from 'node:fs';
import path from 'node:path';
import { getConfig, loadEnvFile, upsertEnvValue } from './env.js';
import { httpGetOk } from './http.js';
import { rebaseModelLinks } from './modelLinksDb.js';
import { dependenciesDir, legacyComfyDir, legacyRuntimeDir } from './paths.js';
import { isPidAlive, readPids } from './process.js';

/**
 * What an older install still keeps straight in the Darkroom folder.
 * ComfyUI only counts when it's the one Darkroom uses (COMFY_DIR).
 */
export function legacyLayout() {
  const env = loadEnvFile();
  const comfy = legacyComfyDir();
  const comfyDir = env.COMFY_DIR || process.env.COMFY_DIR || '';
  const comfyInUse = Boolean(comfy && comfyDir && path.resolve(comfyDir) === path.resolve(comfy));
  const runtime = fs.existsSync(legacyRuntimeDir) && !fs.existsSync(path.join(dependenciesDir, 'runtime')) ? legacyRuntimeDir : null;
  return {
    comfy: comfyInUse && !fs.existsSync(path.join(dependenciesDir, path.basename(comfy))) ? comfy : null,
    runtime,
  };
}

/** Darkroom server or ComfyUI still running (they hold files open). */
export async function servicesRunning() {
  const cfg = getConfig();
  const pids = readPids();
  const server = Boolean(pids.server?.pid && isPidAlive(pids.server.pid)) || (await httpGetOk(`${cfg.appUrl}/api/health`));
  const comfy = !cfg.remote && (await httpGetOk(`${cfg.comfyUrl}/system_stats`));
  return { server, comfy };
}

/**
 * A moved Python venv still names its old folder in the scripts in bin/ (shebang lines,
 * activate). Rewrite those; the interpreter itself links outside the folder.
 * @param {string} venv
 * @param {string} from
 * @param {string} to
 */
function rebaseVenv(venv, from, to) {
  const bin = path.join(venv, process.platform === 'win32' ? 'Scripts' : 'bin');
  if (!fs.existsSync(bin)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(bin)) {
    const file = path.join(bin, name);
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > 2_000_000) continue;
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) continue; // binary
    const text = buf.toString('utf8');
    if (!text.includes(from)) continue;
    fs.writeFileSync(file, text.split(from).join(to));
    fs.chmodSync(file, st.mode);
    n++;
  }
  return n;
}

/**
 * Move ComfyUI and/or the portable tools from the Darkroom folder into dependencies/.
 * Same disk, so it's a rename (instant, no copying). Fixes the venv scripts, .env and the
 * model-link records that name the old place.
 * @param {{ comfy: string | null, runtime: string | null }} what
 * @param {{ dependenciesDir?: string, envFile?: string, rebaseLinks?: (from: string, to: string) => number }} [opts]
 * @returns {{ moved: string[], notes: string[] }}
 */
export function tidyFolders(what, opts = {}) {
  // Overridable for tests (a scratch Darkroom folder)
  const deps = opts.dependenciesDir ?? dependenciesDir;
  const envFile = opts.envFile;
  fs.mkdirSync(deps, { recursive: true });
  const moved = [];
  const notes = [];

  if (what.runtime) {
    // Windows locks the folder of the running node.exe
    const runningFromIt = process.execPath.startsWith(what.runtime + path.sep);
    if (process.platform === 'win32' && runningFromIt) {
      notes.push('The portable tools stay in runtime\\ for now — Windows keeps them locked while the launcher runs from them.');
    } else {
      fs.renameSync(what.runtime, path.join(deps, 'runtime'));
      moved.push('runtime → dependencies/runtime');
    }
  }

  if (what.comfy) {
    const from = what.comfy;
    const to = path.join(deps, path.basename(from));
    fs.renameSync(from, to);
    moved.push(`${path.basename(from)} → dependencies/${path.basename(from)}`);
    const venvFixed = rebaseVenv(path.join(to, 'venv'), from, to);
    if (venvFixed) notes.push(`Updated ${venvFixed} script(s) in ComfyUI's Python environment.`);
    const env = loadEnvFile(envFile);
    for (const key of ['COMFY_DIR', 'COMFY_PYTHON']) {
      const v = env[key];
      if (v && (v === from || v.startsWith(from + path.sep))) {
        const next = to + v.slice(from.length);
        upsertEnvValue(key, next, envFile);
        process.env[key] = next;
      }
    }
    try {
      const n = (opts.rebaseLinks ?? rebaseModelLinks)(from, to);
      if (n) notes.push(`Updated ${n} linked-model record(s).`);
    } catch {
      notes.push('Could not update linked-model records (they are re-checked by Doctor).');
    }
  }
  return { moved, notes };
}
