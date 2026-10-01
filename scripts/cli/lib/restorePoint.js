import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { getGitBin, getComfyPython, restorePointsDir, root } from './paths.js';
import { handleCancel } from './prompt.js';
import { runCommand } from './process.js';

/**
 * @param {string} componentId
 * @param {{ comfyDir?: string, extra?: Record<string, unknown> }} [opts]
 */
export function createRestorePoint(componentId, opts = {}) {
  fs.mkdirSync(restorePointsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = `${stamp}-${componentId}`;
  const dir = path.join(restorePointsDir, id);
  fs.mkdirSync(dir, { recursive: true });

  /** @type {Record<string, unknown>} */
  const meta = {
    id,
    componentId,
    createdAt: new Date().toISOString(),
    platform: process.platform,
    ...opts.extra,
  };

  const git = getGitBin();
  const darkroomHash = spawnSync(git, ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (darkroomHash.status === 0) {
    meta.darkroomGitHash = darkroomHash.stdout.trim();
  }

  if (opts.comfyDir) {
    const comfyRoot = opts.comfyDir;
    const hash = spawnSync(git, ['rev-parse', 'HEAD'], {
      cwd: comfyRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (hash.status === 0) meta.comfyGitHash = hash.stdout.trim();

    const python = getComfyPython(comfyRoot);
    const freeze = spawnSync(python, ['-m', 'pip', 'freeze'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000,
    });
    if (freeze.status === 0 && freeze.stdout) {
      fs.writeFileSync(path.join(dir, 'pip-freeze.txt'), freeze.stdout, 'utf8');
      meta.pipFreeze = 'pip-freeze.txt';
    }
  }

  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  return { id, dir, meta };
}

/**
 * @param {{ id: string, dir: string, meta: Record<string, unknown> }} point
 * @param {{ comfyDir?: string }} [opts]
 */
export async function rollbackRestorePoint(point, opts = {}) {
  const meta = point.meta;
  const git = getGitBin();

  if (meta.darkroomGitHash && typeof meta.darkroomGitHash === 'string') {
    p.log.step(`Rolling back Darkroom to ${meta.darkroomGitHash.slice(0, 8)}…`);
    await runCommand(git, ['checkout', meta.darkroomGitHash], { cwd: root, stdio: 'inherit' });
  }

  if (opts.comfyDir && meta.comfyGitHash && typeof meta.comfyGitHash === 'string') {
    p.log.step(`Rolling back ComfyUI to ${String(meta.comfyGitHash).slice(0, 8)}…`);
    await runCommand(git, ['checkout', String(meta.comfyGitHash)], {
      cwd: opts.comfyDir,
      stdio: 'inherit',
    });
  }

  if (opts.comfyDir && meta.pipFreeze === 'pip-freeze.txt') {
    const freezeFile = path.join(point.dir, 'pip-freeze.txt');
    if (fs.existsSync(freezeFile)) {
      const python = getComfyPython(opts.comfyDir);
      p.log.step('Restoring pip packages from freeze…');
      await runCommand(python, ['-m', 'pip', 'install', '-r', freezeFile], {
        cwd: opts.comfyDir,
        stdio: 'inherit',
      });
    }
  }

  p.log.success(`Restored from ${point.id}`);
}

/**
 * Wrap an update: create restore point, run fn, offer rollback on failure.
 * @template T
 * @param {string} componentId
 * @param {{ comfyDir?: string, extra?: Record<string, unknown> }} opts
 * @param {(point: { id: string, dir: string, meta: Record<string, unknown> }) => Promise<T>} fn
 */
export async function withRestorePoint(componentId, opts, fn) {
  const point = createRestorePoint(componentId, opts);
  p.log.info(`Restore point: ${point.id}`);
  try {
    return await fn(point);
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
    const ok = await p.confirm({
      message: 'Update failed. Roll back to the restore point?',
      initialValue: true,
    });
    if (!handleCancel(ok) && ok) {
      try {
        await rollbackRestorePoint(point, { comfyDir: opts.comfyDir });
      } catch (rbErr) {
        p.log.error(rbErr instanceof Error ? rbErr.message : String(rbErr));
      }
    }
    throw err;
  }
}
