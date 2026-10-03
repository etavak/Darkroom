import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tidyFolders } from '../lib/tidyFolders.js';
import { retireOldStartFiles } from '../lib/retireStartFiles.js';
import { isPreserved } from '../lib/zipUpdate.js';
import { installedControlNetIds } from '../lib/controlnetModels.js';

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'darkroom-folder-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('Tidy up folders', () => {
  it('moves ComfyUI and runtime into dependencies/ and fixes what names the old place', () => {
    const comfy = path.join(root, 'ComfyUI');
    fs.mkdirSync(path.join(comfy, 'venv', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(comfy, 'main.py'), '');
    fs.writeFileSync(path.join(comfy, 'venv', 'bin', 'pip'), `#!${comfy}/venv/bin/python\nimport pip\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(comfy, 'venv', 'bin', 'activate'), `VIRTUAL_ENV=${comfy}/venv\n`);
    fs.mkdirSync(path.join(root, 'runtime', 'node'), { recursive: true });
    const envFile = path.join(root, '.env');
    fs.writeFileSync(envFile, `COMFY_DIR=${comfy}\nCOMFY_PYTHON=${comfy}/venv/bin/python\nPORT=3001\n`);
    let rebased = null;

    const r = tidyFolders(
      { comfy, runtime: path.join(root, 'runtime') },
      { dependenciesDir: path.join(root, 'dependencies'), envFile, rebaseLinks: (from, to) => ((rebased = [from, to]), 1) },
    );

    const moved = path.join(root, 'dependencies', 'ComfyUI');
    expect(r.moved).toHaveLength(2);
    expect(fs.existsSync(path.join(moved, 'main.py'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'dependencies', 'runtime', 'node'))).toBe(true);
    expect(fs.readFileSync(path.join(moved, 'venv', 'bin', 'pip'), 'utf8').split('\n')[0]).toBe(`#!${moved}/venv/bin/python`);
    expect(fs.statSync(path.join(moved, 'venv', 'bin', 'pip')).mode & 0o111).toBeTruthy();
    expect(fs.readFileSync(envFile, 'utf8')).toContain(`COMFY_DIR=${moved}\n`);
    expect(fs.readFileSync(envFile, 'utf8')).toContain('PORT=3001');
    expect(rebased).toEqual([comfy, moved]);
  });
});

describe('old start files', () => {
  it('are removed once (macOS / Linux), with a note', () => {
    for (const f of ['Darkroom.command', 'Darkroom.sh', 'Darkroom.bat']) fs.writeFileSync(path.join(root, f), '');
    if (process.platform === 'win32') return;
    expect(retireOldStartFiles(root)).toMatch(/Start Darkroom|start-linux/);
    expect(fs.readdirSync(root)).toEqual([]);
    expect(retireOldStartFiles(root)).toBe(null);
  });
});

describe('updates', () => {
  it('never touch what the user downloaded or made', () => {
    for (const p of ['dependencies/ComfyUI/main.py', 'runtime/node/x', 'ComfyUI/main.py', 'server/data/darkroom.db', 'node_modules/x/y.js', '.env', 'logs/server.log']) {
      expect(isPreserved(p)).toBe(true);
    }
    for (const p of ['launcher/index.js', 'server/src/app.ts', 'scripts/cli/index.js', 'client/src/App.tsx']) expect(isPreserved(p)).toBe(false);
  });
});

describe('ControlNet models', () => {
  it('count as installed by name, including the old "dep-" prefix', () => {
    const ids = installedControlNetIds([{ name: 'dep-control_v11p_sd15_openpose_fp16.safetensors' }, { name: 'xinsir-controlnet-union-sdxl-promax.safetensors' }, { name: 'other.safetensors' }]);
    expect([...ids].sort()).toEqual(['cn_sd15_openpose', 'cn_sdxl_union_promax']);
  });
});
