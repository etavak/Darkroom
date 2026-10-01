import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import {
  installModelFile,
  isPickleExtension,
  listFamilies,
  normalizeDraggedPath,
  saveCheckpointFamily,
} from '../lib/models.js';
import { handleCancel } from '../lib/prompt.js';
import { guessModelType, MODEL_TYPE_OPTIONS } from '../lib/safetensors.js';

/**
 * Shared confirm + install flow after a local file is available.
 * @param {string} filePath
 * @param {{ preferredName?: string, afterInstall?: (dest: string, filename: string, type: string) => Promise<void> }} [extra]
 */
export async function confirmAndInstallModel(filePath, extra = {}) {
  if (!fs.existsSync(filePath)) {
    p.log.error(`File not found: ${filePath}`);
    return null;
  }

  if (isPickleExtension(filePath)) {
    p.log.warn(
      '.ckpt / .pt files use Python pickle and can execute code when loaded. Prefer .safetensors.',
    );
    const proceed = await p.confirm({
      message: 'Install this pickle-format file anyway?',
      initialValue: false,
    });
    if (handleCancel(proceed) || !proceed) return null;
  }

  const guessed = guessModelType(filePath);
  const type = await p.select({
    message: `Model type (guessed: ${guessed})`,
    options: MODEL_TYPE_OPTIONS.map((o) => ({
      ...o,
      hint: o.value === guessed ? 'detected' : undefined,
    })),
    initialValue: guessed === 'unknown' ? 'checkpoint' : guessed,
  });
  if (handleCancel(type)) return null;

  const mode = await p.select({
    message: 'Install method',
    options: [
      { value: 'copy', label: 'Copy into ComfyUI models folder' },
      { value: 'move', label: 'Move into ComfyUI models folder' },
    ],
  });
  if (handleCancel(mode)) return null;

  let dest;
  let filename;
  try {
    ({ dest, filename } = installModelFile(filePath, /** @type {string} */ (type), /** @type {'copy'|'move'} */ (mode)));
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
    return null;
  }

  if (extra.preferredName && extra.preferredName !== filename) {
    // keep downloaded name
  }

  p.log.success(`Installed → ${dest}`);

  if (type === 'checkpoint') {
    const families = listFamilies();
    if (families.length > 0) {
      const family = await p.select({
        message: 'Map checkpoint to model family',
        options: [
          { value: '', label: 'Skip for now' },
          ...families.map((f) => ({ value: f.id, label: f.name, hint: f.id })),
        ],
      });
      if (!handleCancel(family) && family) {
        saveCheckpointFamily(filename, /** @type {string} */ (family));
        p.log.success(`Saved family “${family}” for ${filename}`);
      }
    }
  }

  if (extra.afterInstall) {
    await extra.afterInstall(dest, filename, /** @type {string} */ (type));
  }

  return { dest, filename, type };
}

export async function installModelFromFile() {
  const raw = await p.text({
    message: 'Path to model file (drag & drop is fine)',
    placeholder: '/path/to/model.safetensors',
    validate: (v) => {
      if (!v?.trim()) return 'Path required';
    },
  });
  if (handleCancel(raw)) return;

  const filePath = normalizeDraggedPath(String(raw));
  const ext = path.extname(filePath).toLowerCase();
  if (!['.safetensors', '.ckpt', '.pt', '.pth', '.bin'].includes(ext)) {
    p.log.warn(`Unusual extension ${ext || '(none)'} — continuing anyway`);
  }

  await confirmAndInstallModel(filePath);
}
