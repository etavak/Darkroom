import path from 'node:path';
import * as p from '@clack/prompts';
import {
  downloadFile,
  downloadsCacheDir,
  resolveModelUrl,
  saveModelSidecars,
} from '../lib/download.js';
import { getConfig } from '../lib/env.js';
import { handleCancel } from '../lib/prompt.js';
import { confirmAndInstallModel } from './installModel.js';

export async function downloadModelFromUrl() {
  const cfg = getConfig();
  const raw = await p.text({
    message: 'Model URL (Civitai, Hugging Face, or direct file link)',
    placeholder: 'https://civitai.com/models/...',
    validate: (v) => {
      if (!v?.trim()) return 'URL required';
      try {
        new URL(v.trim());
      } catch {
        return 'Invalid URL';
      }
    },
  });
  if (handleCancel(raw)) return;

  const pageUrl = String(raw).trim();
  if (/civitai\.com/i.test(pageUrl) && !cfg.civitaiToken) {
    p.log.warn('CIVITAI_TOKEN not set in .env — public files may still work; early-access will fail.');
  }

  const s = p.spinner();
  s.start('Resolving download…');
  let meta;
  try {
    meta = await resolveModelUrl(pageUrl);
    s.stop(`Found: ${meta.modelName}`);
  } catch (err) {
    s.stop('Resolve failed');
    p.log.error(err instanceof Error ? err.message : String(err));
    return;
  }

  if (meta.triggerWords?.length) {
    p.note(meta.triggerWords.join(', '), 'Trigger words');
  }

  const cache = downloadsCacheDir();
  const tempPath = path.join(cache, meta.filename);
  p.log.info(`Downloading ${meta.filename}…`);
  try {
    await downloadFile(meta.downloadUrl, tempPath, {
      headers: {
        ...(meta.headers || {}),
        ...(cfg.civitaiToken && /civitai\.com/i.test(meta.downloadUrl)
          ? { Authorization: `Bearer ${cfg.civitaiToken}` }
          : {}),
      },
    });
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
    return;
  }

  await confirmAndInstallModel(tempPath, {
    preferredName: meta.filename,
    afterInstall: async (dest) => {
      await saveModelSidecars(dest, {
        triggerWords: meta.triggerWords,
        previewUrl: meta.previewUrl,
        sourceUrl: pageUrl,
        modelName: meta.modelName,
        headers: meta.headers,
      });
      if (meta.triggerWords?.length) {
        p.log.success('Saved trigger words + preview sidecar');
      } else if (meta.previewUrl) {
        p.log.success('Saved preview sidecar');
      }
    },
  });
}
