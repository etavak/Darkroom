import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import {
  downloadFile,
  downloadsCacheDir,
  formatBytes,
  resolveModelUrl,
  civitaiAutoFetchEnabled,
  saveModelSidecars,
} from '../lib/download.js';
import { getConfig, upsertEnvValue } from '../lib/env.js';
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
    const key = await p.password({
      message: 'Civitai API key (optional — some files need sign-in; Enter to skip). civitai.com → Account settings → API keys',
    });
    if (handleCancel(key)) return;
    const k = String(key ?? '').trim();
    if (k) {
      upsertEnvValue('CIVITAI_TOKEN', k);
      process.env.CIVITAI_TOKEN = k;
      cfg.civitaiToken = k;
      p.log.success('Saved the Civitai key in .env');
    }
  }
  if (/huggingface\.co/i.test(pageUrl) && !cfg.hfToken) {
    p.log.info('Tip: set HF_TOKEN in .env for gated Hugging Face repos.');
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

  if (meta.candidates && meta.candidates.length > 1) {
    const pick = await p.select({
      message: 'Which file to download?',
      options: meta.candidates.map((c) => ({
        value: c.path,
        label: c.path,
        hint: formatBytes(c.size),
      })),
      initialValue: meta.candidates[0]?.path,
    });
    if (handleCancel(pick)) return;
    const chosen = meta.candidates.find((c) => c.path === pick);
    if (!chosen) return;
    meta = {
      ...meta,
      downloadUrl: chosen.downloadUrl,
      filename: chosen.filename,
      modelName: `${meta.modelName}/${chosen.path}`,
    };
    p.log.info(`Selected ${chosen.path} (${formatBytes(chosen.size)})`);
  } else if (meta.candidates?.length === 1) {
    p.log.info(`${meta.candidates[0].path} (${formatBytes(meta.candidates[0].size)})`);
  }

  if (meta.triggerWords?.length) {
    p.note(meta.triggerWords.join(', '), 'Trigger words');
  }

  const cache = downloadsCacheDir();
  // Flatten nested HF paths in the cache filename
  const safeName = meta.filename.replace(/[\\/]/g, '__');
  const tempPath = path.join(cache, safeName);
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

  try {
    const bytes = fs.statSync(tempPath).size;
    if (bytes < 1024 * 1024) {
      p.log.error(
        `Download is only ${formatBytes(bytes)} — that is not a model file. Check the URL or pick a different file from the repo.`,
      );
      fs.rmSync(tempPath, { force: true });
      return;
    }
  } catch {
    // ignore
  }

  /** @type {import('../lib/dependencies.js').ComponentDef[]} */
  const companionComponents = (meta.companions || [])
    .filter((c) => c.fileType === 'VAE' || /vae/i.test(c.filename))
    .map((c) => ({
      id: `civitai-vae-${c.filename}`,
      type: 'vae',
      filename: c.filename,
      url: c.downloadUrl,
      sizeBytes: c.size,
      sha256: c.sha256 || '',
      gated: false,
      notes: 'VAE listed on the Civitai model version',
    }));

  await confirmAndInstallModel(tempPath, {
    preferredName: meta.filename,
    allowLink: false,
    companionComponents,
    afterInstall: async (dest) => {
      if (!civitaiAutoFetchEnabled()) return;
      await saveModelSidecars(dest, {
        triggerWords: meta.triggerWords,
        previewUrl: meta.previewUrl,
        sourceUrl: pageUrl,
        modelName: meta.modelName,
        baseModel: meta.baseModel,
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
