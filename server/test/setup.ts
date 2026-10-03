import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';
import { startFakeComfy } from './fakeComfy';

// Before any server module loads: a throwaway data folder, .env, tag dictionaries and
// ComfyUI folder, and a fake ComfyUI — tests never touch real data or a real ComfyUI.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darkroom-test-'));
process.env.DARKROOM_DATA_DIR = path.join(tmp, 'data');
process.env.DARKROOM_ENV_FILE = path.join(tmp, '.env');
process.env.DARKROOM_TAGS_DIR = path.resolve(__dirname, 'fixtures/tags');
process.env.COMFY_DIR = path.join(tmp, 'ComfyUI');
process.env.COMFY_MODE = 'local';
fs.mkdirSync(path.join(tmp, 'ComfyUI', 'models', 'loras'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'ComfyUI', 'main.py'), '');
fs.writeFileSync(process.env.DARKROOM_ENV_FILE, '');

const comfy = await startFakeComfy();
process.env.COMFY_URL = comfy.url;

afterAll(async () => {
  await comfy.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
