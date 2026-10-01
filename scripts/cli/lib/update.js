import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { getConfig } from './env.js';
import { getComfyPortableRoot, getComfyUiRoot, root, tagsDir } from './paths.js';
import { runCommand } from './process.js';

const TAG_SOURCES = [
  {
    name: 'danbooru.csv',
    url: 'https://raw.githubusercontent.com/DominikDoom/a1111-sd-webui-tagcomplete/master/tags/danbooru.csv',
  },
  {
    name: 'e621.csv',
    url: 'https://raw.githubusercontent.com/DominikDoom/a1111-sd-webui-tagcomplete/master/tags/e621.csv',
  },
];

export async function gitPullDarkroom() {
  if (!fs.existsSync(path.join(root, '.git'))) {
    throw new Error('Darkroom is not a git checkout — skip repo update');
  }
  await runCommand('git', ['pull', '--ff-only'], { cwd: root, stdio: 'inherit' });
}

export async function updateComfyUI() {
  const cfg = getConfig();
  const ui = getComfyUiRoot(cfg.comfyDir);
  if (!ui || !fs.existsSync(path.join(ui, '.git'))) {
    // Windows portable often has git inside ComfyUI subfolder
    const portable = getComfyPortableRoot(cfg.comfyDir);
    const nested = portable ? path.join(portable, 'ComfyUI') : null;
    if (nested && fs.existsSync(path.join(nested, '.git'))) {
      await runCommand('git', ['pull', '--ff-only'], { cwd: nested, stdio: 'inherit' });
      return;
    }
    throw new Error('ComfyUI git repo not found under COMFY_DIR');
  }
  await runCommand('git', ['pull', '--ff-only'], { cwd: ui, stdio: 'inherit' });
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Darkroom/1.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadToFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (!res.statusCode || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => resolve(undefined));
      out.on('error', reject);
    });
    req.on('error', reject);
  });
}

export async function refreshTagCsvs() {
  fs.mkdirSync(tagsDir, { recursive: true });
  for (const src of TAG_SOURCES) {
    const dest = path.join(tagsDir, src.name);
    await downloadToFile(src.url, dest);
  }
  // Keep pony-extra curated locally if missing
  const pony = path.join(tagsDir, 'pony-extra.csv');
  if (!fs.existsSync(pony)) {
    fs.writeFileSync(
      pony,
      `name,category,post_count,aliases
score_9,5,9100000,
score_8,5,9200000,
score_7,5,9300000,
score_6,5,9400000,
score_5,5,9500000,
score_4,5,9600000,
source_anime,5,8000000,
rating_safe,5,7000000,rating_s
rating_questionable,5,4000000,rating_q
rating_explicit,5,5000000,rating_e
`,
      'utf8',
    );
  }
}

/**
 * @returns {{ ok: boolean, text: string }}
 */
export function readNvidiaSmi() {
  if (process.platform === 'darwin') {
    return { ok: false, text: 'nvidia-smi skipped on macOS — see Apple Silicon / MPS section' };
  }
  const r = spawnSync(
    'nvidia-smi',
    [
      '--query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu',
      '--format=csv,noheader',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r.error || r.status !== 0) {
    return { ok: false, text: 'nvidia-smi not available' };
  }
  return { ok: true, text: (r.stdout || '').trim() };
}

export function readSystemSummary() {
  const lines = [
    `Platform: ${process.platform} ${process.arch}`,
    `Node: ${process.version}`,
    `Darkroom: ${root}`,
    `COMFY_MODE: ${process.env.COMFY_MODE || 'local'}`,
    `COMFY_DIR: ${process.env.COMFY_DIR || '(not set)'}`,
    `COMFY_URL: ${process.env.COMFY_URL || '(default)'}`,
  ];
  return lines.join('\n');
}
