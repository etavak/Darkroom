import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { civitaiAutoFetchEnabled, fetchCivitaiSidecarsByHash } from '../lib/download.js';
import { defaultInstallMode } from '../lib/linkInstall.js';
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
 * @param {{
 *   preferredName?: string,
 *   afterInstall?: (dest: string, filename: string, type: string) => Promise<void>,
 *   mode?: 'copy' | 'move' | 'link',
 *   allowLink?: boolean,
 *   family?: string,
 *   companionComponents?: Array<import('../lib/dependencies.js').ComponentDef>,
 * }} [extra]
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

  const allowLink = extra.allowLink !== false;
  /** @type {'copy' | 'move' | 'link'} */
  let mode =
    extra.mode ||
    (allowLink ? defaultInstallMode(filePath) : 'move');
  if (!extra.mode) {
    const options = [
      ...(allowLink
        ? [{ value: 'link', label: 'Link (symlink / hard link)', hint: 'keeps the file in place' }]
        : []),
      { value: 'copy', label: 'Copy into ComfyUI models folder' },
      { value: 'move', label: 'Move into ComfyUI models folder' },
    ];
    const picked = await p.select({
      message: 'Install method',
      options,
      initialValue: mode === 'link' && !allowLink ? 'move' : mode,
    });
    if (handleCancel(picked)) return null;
    mode = /** @type {'copy' | 'move' | 'link'} */ (picked);
  }

  let dest;
  let filename;
  /** @type {'symlink' | 'hardlink' | undefined} */
  let linkType;
  try {
    ({ dest, filename, linkType } = installModelFile(
      filePath,
      /** @type {string} */ (type),
      mode,
    ));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    p.log.error(message);
    if (mode === 'link' && /Choose Copy instead/i.test(message)) {
      const fallback = await p.confirm({
        message: 'Fall back to Copy?',
        initialValue: true,
      });
      if (!handleCancel(fallback) && fallback) {
        try {
          ({ dest, filename } = installModelFile(
            filePath,
            /** @type {string} */ (type),
            'copy',
          ));
          mode = 'copy';
        } catch (err2) {
          p.log.error(err2 instanceof Error ? err2.message : String(err2));
          return null;
        }
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  if (extra.preferredName && extra.preferredName !== filename) {
    // keep downloaded name
  }

  if (mode === 'link' && linkType) {
    p.log.success(`Linked (${linkType}) → ${dest}`);
    p.log.info(`Original kept at ${path.resolve(filePath)}`);
  } else {
    p.log.success(`Installed → ${dest}`);
  }

  /** @type {string | undefined} */
  let mappedFamily;
  if (type === 'checkpoint' || type === 'diffusion') {
    const families = listFamilies();
    const gguf = /\.gguf$/i.test(filename);
    const options = families
      .filter((f) => {
        if (!gguf) return true;
        return f.id === 'flux' || f.id === 'sd3' || f.supportsGguf;
      })
      .map((f) => ({ value: f.id, label: f.name, hint: f.id }));
    if (options.length > 0) {
      const family = await p.select({
        message:
          type === 'diffusion' ? 'Map diffusion model to family' : 'Map checkpoint to model family',
        options: [{ value: '', label: 'Skip for now' }, ...options],
      });
      if (!handleCancel(family) && family) {
        mappedFamily = /** @type {string} */ (family);
        saveCheckpointFamily(filename, mappedFamily);
        p.log.success(`Saved family “${mappedFamily}” for ${filename}`);
      }
    }
  }

  const depFamily = mappedFamily || extra.family || '';
  const companions = extra.companionComponents || [];
  if (depFamily || companions.length) {
    try {
      const { resolveDependenciesInteractive } = await import('../lib/dependencies.js');
      // Use family when known; otherwise a placeholder so Civitai VAE extras still resolve
      await resolveDependenciesInteractive(depFamily || '_companions', {
        extras: companions,
        prompt: p,
        handleCancel,
      });
    } catch (err) {
      p.log.warn(err instanceof Error ? err.message : String(err));
    }
  }

  if (/\.gguf$/i.test(filename)) {
    try {
      const { getComponent } = await import('../components/registry.js');
      const ggufComp = getComponent('node:comfyui-gguf');
      if (ggufComp) {
        const st = await ggufComp.status();
        if (st.state === 'missing') {
          const ok = await p.confirm({
            message: 'Install ComfyUI-GGUF support? (optional custom node for .gguf models)',
            initialValue: true,
          });
          if (!handleCancel(ok) && ok) {
            await ggufComp.install({});
            p.log.success('ComfyUI-GGUF installed — restart ComfyUI to load the nodes');
          }
        }
      }
    } catch (err) {
      p.log.warn(err instanceof Error ? err.message : String(err));
    }
  }

  if (extra.afterInstall) {
    await extra.afterInstall(dest, filename, /** @type {string} */ (type));
  }

  return { dest, filename, type, mode, linkType };
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
  if (!['.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf'].includes(ext)) {
    p.log.warn(`Unusual extension ${ext || '(none)'} — continuing anyway`);
  }

  await confirmAndInstallModel(filePath, {
    allowLink: true,
    afterInstall: async (dest) => {
      if (!civitaiAutoFetchEnabled()) return;
      const s = p.spinner();
      s.start('Looking up this file on Civitai…');
      try {
        const found = await fetchCivitaiSidecarsByHash(dest);
        s.stop(found ? 'Saved Civitai trigger words + preview' : 'Not found on Civitai');
      } catch (err) {
        s.stop(`Civitai lookup skipped: ${err instanceof Error ? err.message : err}`);
      }
    },
  });
}
