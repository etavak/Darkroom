import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { downloadFile } from '../lib/download.js';
import { loadPins } from '../lib/pins.js';
import { getModelsRoot, tagsDir } from '../lib/paths.js';
import { refreshTagCsvs } from '../lib/update.js';

/**
 * @param {string} [comfyDir]
 */
export async function downloadTaesdDecoders(comfyDir) {
  const models = getModelsRoot(comfyDir);
  if (!models) {
    p.log.warn('Skipping TAESD — no local ComfyUI models folder');
    return;
  }
  const destDir = path.join(models, 'vae_approx');
  fs.mkdirSync(destDir, { recursive: true });

  for (const file of loadPins().taesd?.files || []) {
    const dest = path.join(destDir, file.name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 10_000) {
      p.log.info(`TAESD exists: ${file.name}`);
      continue;
    }
    p.log.info(`Downloading ${file.name}…`);
    try {
      await downloadFile(file.url, dest);
    } catch (err) {
      p.log.warn(
        `Could not download ${file.name}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

export async function downloadTagDictionaries() {
  fs.mkdirSync(tagsDir, { recursive: true });
  p.log.info('Downloading tag CSVs…');
  await refreshTagCsvs();
  p.log.success(`Tags ready in ${tagsDir}`);
}

/**
 * @param {{ comfyDir?: string, remote?: boolean }} opts
 */
export async function downloadSetupAssets(opts) {
  await downloadTagDictionaries();
  if (!opts.remote) {
    await downloadTaesdDecoders(opts.comfyDir);
  }
}
