import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import {
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
    settings,
    diskUsage: getDiskUsage(),
    hints: settingsHints(settings),
  });
});

settingsRouter.put('/', (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<ServerSettings>;
    const settings = saveServerSettings(body);
    res.json({
      settings,
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
    const r = await fetch(`${config.comfyUrl}/system_stats`);
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

  res.json({ text: lines.join('\n'), diskUsage: disk, settings });
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
