import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { isLocalRequest } from '../services/lanAuth.js';
import { checkForUpdate, currentVersion } from '../services/updates.js';
import {
  emptyTrash,
  getDiskUsage,
  loadServerSettings,
  runBackup,
  saveServerSettings,
  settingsHints,
  type ServerSettings,
} from '../services/appSettings.js';
import {
  getComfyUiRoot,
  qualityToPreviewMethod,
  readEnvValue,
  supportsPerPromptPreviewMethod,
  upsertEnvValue,
} from '../services/envSettings.js';

export const settingsRouter = Router();

/** Settings as sent to browsers: secrets are write-only (a flag says one is saved). */
function publicSettings(settings: ServerSettings) {
  return { ...settings, enhanceApiKey: '', enhanceApiKeySet: Boolean(settings.enhanceApiKey) };
}

settingsRouter.get('/preview', (_req, res) => {
  res.json({
    supportsPerPromptPreview: supportsPerPromptPreviewMethod(),
    launchPreviewMethod: readEnvValue('COMFY_PREVIEW_METHOD') || 'auto',
  });
});

settingsRouter.put('/preview', (req, res) => {
  const quality = req.body?.quality;
  if (quality !== 'fast' && quality !== 'detailed') {
    res.status(400).json({ error: 'quality must be "fast" or "detailed"' });
    return;
  }

  const supports = supportsPerPromptPreviewMethod();
  const method = qualityToPreviewMethod(quality);

  if (!supports) {
    upsertEnvValue('COMFY_PREVIEW_METHOD', method);
  }

  res.json({
    supportsPerPromptPreview: supports,
    launchPreviewMethod: supports
      ? 'auto'
      : readEnvValue('COMFY_PREVIEW_METHOD') || method,
    previewMethod: method,
  });
});

settingsRouter.get('/', (_req, res) => {
  const settings = loadServerSettings();
  res.json({
    settings: publicSettings(settings),
    diskUsage: getDiskUsage(),
    hints: settingsHints(settings),
  });
});

settingsRouter.put('/', (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<ServerSettings>;
    const settings = saveServerSettings(body);
    res.json({
      settings: publicSettings(settings),
      diskUsage: getDiskUsage(),
      hints: settingsHints(settings),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Save failed' });
  }
});

settingsRouter.get('/disk', (_req, res) => {
  res.json(getDiskUsage());
});

/** Host only: permanently deletes the trashed images. */
settingsRouter.post('/trash/empty', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Empty the trash from the computer running Darkroom.' });
    return;
  }
  try {
    const removed = emptyTrash();
    res.json({ ok: true, removed, diskUsage: getDiskUsage() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Could not empty the trash' });
  }
});

const TOKEN_KEYS = { civitai: 'CIVITAI_TOKEN', huggingface: 'HF_TOKEN' } as const;
const KEY_RE = /^[A-Za-z0-9_-]{20,200}$/;
const tokenValue = (k: string) => (process.env[k] || readEnvValue(k) || '').trim();
const tokenSet = (k: string) => KEY_RE.test(tokenValue(k));
/** Flags only; `civitaiInvalid` = something is saved but it isn't a key (e.g. a pasted link) */
const tokenFlags = () => ({
  civitai: tokenSet('CIVITAI_TOKEN'),
  civitaiInvalid: Boolean(tokenValue('CIVITAI_TOKEN')) && !tokenSet('CIVITAI_TOKEN'),
  huggingface: tokenSet('HF_TOKEN') || tokenSet('HUGGING_FACE_HUB_TOKEN'),
});

/** Which download keys are saved (never the keys themselves). */
settingsRouter.get('/tokens', (_req, res) => {
  res.json(tokenFlags());
});

/** Host only: save or remove ('' ) the Civitai / Hugging Face keys in .env. */
settingsRouter.put('/tokens', (req, res) => {
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: 'Set download keys on the computer running Darkroom.' });
    return;
  }
  for (const [field, key] of Object.entries(TOKEN_KEYS)) {
    const v = req.body?.[field];
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (t && !KEY_RE.test(t)) {
      res.status(400).json({
        error: /:\/\/|\.(com|co)\b/i.test(t)
          ? 'That’s a link, not a key. Copy the key itself (civitai.com → Account settings → API keys).'
          : 'That doesn’t look like a key — it should be letters and numbers only, no spaces.',
      });
      return;
    }
    upsertEnvValue(key, t);
    process.env[key] = t;
    if (key === 'HF_TOKEN' && !t) process.env.HUGGING_FACE_HUB_TOKEN = '';
  }
  res.json(tokenFlags());
});

settingsRouter.get('/version', (_req, res) => {
  res.json(currentVersion());
});

/** Newest commit on GitHub vs the installed one. Updating itself happens in the launcher. */
settingsRouter.get('/updates', async (req, res) => {
  res.json(await checkForUpdate(req.query.force === '1'));
});

settingsRouter.post('/backup', (_req, res) => {
  const result = runBackup();
  if (!result.ok) {
    res.status(500).json({ error: 'Backup failed' });
    return;
  }
  res.json({ ok: true, path: result.path, diskUsage: getDiskUsage() });
});

settingsRouter.get('/diagnostics', async (_req, res) => {
  const settings = loadServerSettings();
  const disk = getDiskUsage();
  let comfyOk = false;
  try {
    const r = await fetch(`${config.comfyUrl}/system_stats`, { signal: AbortSignal.timeout(5_000) });
    comfyOk = r.ok;
  } catch {
    comfyOk = false;
  }

  const lines = [
    `Darkroom diagnostics — ${new Date().toISOString()}`,
    `Platform: ${process.platform} ${os.arch()}`,
    `Node: ${process.version}`,
    `Hostname: ${os.hostname()}`,
    `ComfyUI: ${comfyOk ? 'online' : 'offline'} (${config.comfyUrl})`,
    `COMFY_DIR: ${process.env.COMFY_DIR || readEnvValue('COMFY_DIR') || '(unset)'}`,
    `UI root: ${getComfyUiRoot() || '(unset)'}`,
    `Data: ${config.dataDir}`,
    `VRAM mode: ${settings.vramMode}`,
    `Delete mode: ${settings.deleteMode}`,
    `Max queue: ${settings.maxQueueLength}`,
    `Unload idle: ${settings.unloadIdleMinutes}m`,
    `Disk images: ${formatBytes(disk.imagesBytes)}`,
    `Disk db: ${formatBytes(disk.dbBytes)}`,
    `Disk trash: ${formatBytes(disk.trashBytes)}`,
    `Disk backups: ${formatBytes(disk.backupsBytes)}`,
    `Log level: ${settings.logLevel}`,
    `Experimental: ${settings.experimentalFeatures}`,
    `Safe mode: ${settings.safeMode}`,
  ];

  const logCandidates = [
    path.join(config.dataDir, '..', '..', 'logs', 'server.log'),
    path.join(config.dataDir, '..', '..', 'logs', 'comfyui.log'),
  ];
  for (const logPath of logCandidates) {
    try {
      if (fs.existsSync(logPath)) {
        const raw = fs.readFileSync(logPath, 'utf8');
        const tail = raw.split(/\r?\n/).slice(-40).join('\n');
        lines.push('', `--- ${path.basename(logPath)} (tail) ---`, tail);
      }
    } catch {
      // ignore
    }
  }

  res.json({ text: lines.join('\n'), diskUsage: disk, settings: publicSettings(settings) });
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
