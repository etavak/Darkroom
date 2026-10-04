import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { mergeInto, runPortableUpdater } from '../components/comfyui.js';
import { moveAside } from '../setup/installComfy.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

/** A ComfyUI-like folder with a "model" in it. */
function fakeComfy(name) {
  const root = path.join(dir, name);
  fs.mkdirSync(path.join(root, 'ComfyUI', 'models', 'checkpoints'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ComfyUI', 'models', 'checkpoints', 'mine.safetensors'), 'weights');
  return root;
}

describe('replacing a ComfyUI folder', () => {
  it('moves the old one aside with everything in it', () => {
    const root = fakeComfy('a');
    const aside = moveAside(root);
    expect(fs.existsSync(root)).toBe(false);
    expect(fs.readFileSync(path.join(aside, 'ComfyUI', 'models', 'checkpoints', 'mine.safetensors'), 'utf8')).toBe('weights');
  });

  // The Windows report: the folder was in use, and the old code was deleting it
  it.runIf(process.platform === 'win32')('a folder in use is left exactly as it was', async () => {
    const root = fakeComfy('b');
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { cwd: root });
    await new Promise((r) => setTimeout(r, 500));
    try {
      expect(() => moveAside(root)).toThrow(/Nothing was deleted/);
      expect(fs.readFileSync(path.join(root, 'ComfyUI', 'models', 'checkpoints', 'mine.safetensors'), 'utf8')).toBe('weights');
    } finally {
      holder.kill();
      await new Promise((r) => holder.once('exit', r));
    }
  });
});

describe('updating the Windows portable in place', () => {
  // A stand-in python that records each call; its first run "updates the updater", like update.py does
  it.runIf(process.platform !== 'win32')('runs update.py, reruns it after it updates itself, then checks requirements', async () => {
    const root = fakeComfy('portable');
    fs.mkdirSync(path.join(root, 'update'));
    fs.writeFileSync(path.join(root, 'update', 'update.py'), 'old');
    const calls = path.join(dir, 'calls.txt');
    const python = path.join(dir, 'python');
    fs.writeFileSync(
      python,
      `#!/bin/sh\necho "$(basename "$PWD") $*" >> "${calls}"\n` +
        `if [ "$1" = update.py ] && [ ! -f "${dir}/ran" ]; then touch "${dir}/ran"; echo new > update_new.py; fi\n`,
      { mode: 0o755 },
    );

    await runPortableUpdater(root, python, true);

    const lines = fs.readFileSync(calls, 'utf8').trim().split('\n');
    expect(lines[0]).toBe(`update update.py ..${path.sep}ComfyUI${path.sep} --stable`);
    expect(lines[1]).toBe(`update update.py ..${path.sep}ComfyUI${path.sep} --skip_self_update --stable`);
    expect(lines[2]).toMatch(/^portable -s -m pip install -r .*requirements\.txt$/);
    expect(fs.readFileSync(path.join(root, 'update', 'update.py'), 'utf8').trim()).toBe('new');
    expect(fs.existsSync(path.join(root, 'update', 'update_new.py'))).toBe(false);
    // nothing of the user's was touched
    expect(fs.existsSync(path.join(root, 'ComfyUI', 'models', 'checkpoints', 'mine.safetensors'))).toBe(true);
  });
});

describe('reinstalling ComfyUI', () => {
  it("puts the kept models into the new install, next to its placeholder files", () => {
    const kept = fakeComfy('kept');
    const fresh = path.join(dir, 'fresh', 'ComfyUI', 'models', 'checkpoints');
    fs.mkdirSync(fresh, { recursive: true });
    fs.writeFileSync(path.join(fresh, 'put_checkpoints_here'), '');
    mergeInto(path.join(kept, 'ComfyUI', 'models'), path.join(dir, 'fresh', 'ComfyUI', 'models'));
    expect(fs.readdirSync(fresh).sort()).toEqual(['mine.safetensors', 'put_checkpoints_here']);
    expect(fs.existsSync(path.join(kept, 'ComfyUI', 'models'))).toBe(false);
  });
});
