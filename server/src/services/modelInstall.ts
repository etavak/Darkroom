import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  loadDownloadModule,
  loadLinkInstallModule,
  loadModelsModule,
  loadSafetensorsModule,
  type GuessedModelType,
  repoRoot,
} from './cliShared.js';
import { readEnvValue } from './envSettings.js';
import { invalidateModelCatalog } from './modelLists.js';
import { invalidatePresetCache } from '../presets/catalog.js';
import { loadServerSettings } from './appSettings.js';

export type InstallMode = 'copy' | 'move' | 'link';

export type InstallJob = {
  id: string;
  status: 'resolving' | 'downloading' | 'detecting' | 'ready' | 'installing' | 'done' | 'error';
  progress: number;
  transferred: number;
  total: number;
  filename?: string;
  guessedType?: GuessedModelType;
  error?: string;
  dest?: string;
  tempPath?: string;
  /** Absolute path on disk for local path installs (supports Link) */
  localPath?: string;
  allowLink?: boolean;
  defaultMode?: InstallMode;
  linkType?: 'symlink' | 'hardlink';
  modelName?: string;
  candidates?: Array<{ path: string; size: number; downloadUrl: string; filename: string }>;
  companions?: Array<{
    path: string;
    size: number;
    downloadUrl: string;
    filename: string;
    fileType: string;
    sha256?: string;
  }>;
  triggerWords?: string[];
  baseModel?: string | null;
  previewUrl?: string | null;
  sourceUrl?: string;
  downloadUrl?: string;
  headers?: Record<string, string>;
};

const jobs = new Map<string, InstallJob>();
const uploadDir = path.join(repoRoot, 'runtime', 'model-uploads');

function ensureUploadDir() {
  fs.mkdirSync(uploadDir, { recursive: true });
}

export function getInstallJob(id: string): InstallJob | null {
  return jobs.get(id) ?? null;
}

export async function resolveModelFromUrl(pageUrl: string): Promise<InstallJob> {
  const id = randomUUID();
  const job: InstallJob = {
    id,
    status: 'resolving',
    progress: 0,
    transferred: 0,
    total: 0,
    sourceUrl: pageUrl,
    allowLink: false,
    defaultMode: 'move',
  };
  jobs.set(id, job);

  try {
    const dl = await loadDownloadModule();
    const meta = await dl.resolveModelUrl(pageUrl);
    job.modelName = meta.modelName;
    job.filename = meta.filename;
    job.triggerWords = meta.triggerWords;
    job.baseModel = meta.baseModel ?? null;
    job.previewUrl = meta.previewUrl;
    job.downloadUrl = meta.downloadUrl;
    job.headers = meta.headers;
    job.candidates = meta.candidates;
    job.companions = meta.companions;
    job.status = 'ready';
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : String(err);
  }
  return job;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export async function startDownloadJob(
  jobId: string,
  opts?: { candidatePath?: string },
): Promise<InstallJob> {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Unknown job');
  if (!job.downloadUrl && !job.candidates?.length) throw new Error('Nothing to download');

  let downloadUrl = job.downloadUrl!;
  let filename = job.filename!;
  // A key saved after the link was resolved (e.g. after a 401) applies on retry
  const rawKey = (process.env.CIVITAI_TOKEN || readEnvValue('CIVITAI_TOKEN') || '').trim();
  const civitaiKey = /^[A-Za-z0-9_-]{20,200}$/.test(rawKey) ? rawKey : '';
  const headers =
    job.headers?.Authorization || !civitaiKey || !/(^|\.)civitai\.com$/i.test(safeHost(downloadUrl))
      ? job.headers
      : { ...(job.headers ?? {}), Authorization: `Bearer ${civitaiKey}` };

  if (opts?.candidatePath && job.candidates?.length) {
    const chosen = job.candidates.find((c) => c.path === opts.candidatePath);
    if (!chosen) throw new Error('Unknown candidate file');
    downloadUrl = chosen.downloadUrl;
    filename = chosen.filename;
    job.filename = filename;
    job.downloadUrl = downloadUrl;
  }

  job.status = 'downloading';
  job.progress = 0;

  const dl = await loadDownloadModule();
  const cache = dl.downloadsCacheDir();
  const safeName = filename.replace(/[\\/]/g, '__');
  const tempPath = path.join(cache, safeName);
  job.tempPath = tempPath;

  // Fire-and-forget download; client polls job
  void (async () => {
    try {
      await dl.downloadFile(downloadUrl, tempPath, {
        headers: headers ?? {},
        quiet: true,
        onProgress: (transferred, total) => {
          job.transferred = transferred;
          job.total = total;
          job.progress = total > 0 ? Math.min(99, (transferred / total) * 100) : 0;
        },
      });
      const bytes = fs.statSync(tempPath).size;
      if (bytes < 1024 * 1024 && !filename.toLowerCase().endsWith('.gguf')) {
        // embeddings can be small; gguf TE can be large; keep 1MB gate for safety except tiny embeddings later
      }
      if (bytes < 50_000) {
        throw new Error(`Download is only ${dl.formatBytes(bytes)} — not a usable model file`);
      }
      job.status = 'detecting';
      const st = await loadSafetensorsModule();
      job.guessedType = st.guessModelType(tempPath);
      job.progress = 100;
      job.status = 'ready';
    } catch (err) {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // ignore
      }
    }
  })();

  return job;
}

/** Reserve a temp path for a streamed upload (the route writes the file). */
export function createUploadTarget(originalName: string): {
  id: string;
  filename: string;
  tempPath: string;
} {
  ensureUploadDir();
  const id = randomUUID();
  const filename = path.basename(originalName).replace(/[^\w.\-()+ ]+/g, '_') || 'model.safetensors';
  return { id, filename, tempPath: path.join(uploadDir, `${id}-${filename}`) };
}

/** Detect the model type of an upload already written to its temp path. */
export async function detectUploadedFile(target: {
  id: string;
  filename: string;
  tempPath: string;
  size: number;
}): Promise<InstallJob> {
  const { id, filename: safe, tempPath, size } = target;
  const job: InstallJob = {
    id,
    status: 'detecting',
    progress: 100,
    transferred: size,
    total: size,
    filename: safe,
    tempPath,
    allowLink: false,
    defaultMode: 'copy',
  };
  jobs.set(id, job);

  try {
    const st = await loadSafetensorsModule();
    job.guessedType = st.guessModelType(tempPath);
    job.status = 'ready';
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : String(err);
  }
  return job;
}

export async function detectLocalPath(rawPath: string): Promise<InstallJob> {
  const models = await loadModelsModule();
  const linkMod = await loadLinkInstallModule();
  const filePath = models.normalizeDraggedPath(rawPath);
  const id = randomUUID();
  const job: InstallJob = {
    id,
    status: 'detecting',
    progress: 100,
    transferred: 0,
    total: 0,
    filename: path.basename(filePath),
    localPath: filePath,
    allowLink: true,
  };
  jobs.set(id, job);

  if (!fs.existsSync(filePath)) {
    job.status = 'error';
    job.error = `File not found: ${filePath}`;
    return job;
  }

  try {
    const st = await loadSafetensorsModule();
    job.guessedType = st.guessModelType(filePath);
    job.tempPath = filePath;
    job.defaultMode = linkMod.defaultInstallMode(filePath);
    job.status = 'ready';
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : String(err);
  }
  return job;
}

export async function confirmInstall(opts: {
  jobId: string;
  type: string;
  family?: string;
  mode?: InstallMode;
}): Promise<InstallJob> {
  const job = jobs.get(opts.jobId);
  if (!job) throw new Error('Unknown job');
  const sourcePath = job.localPath || job.tempPath;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('Temp file missing — re-download, re-upload, or check the path');
  }
  if (/\.gguf$/i.test(job.filename || sourcePath)) {
    if (opts.family && opts.family !== 'flux' && opts.family !== 'sd3') {
      const models = await loadModelsModule();
      const fam = models.listFamilies().find((f) => f.id === opts.family);
      if (fam && !fam.supportsGguf) {
        throw new Error('GGUF models are only supported for Flux / SD3 families');
      }
    }
  }

  job.status = 'installing';
  try {
    const models = await loadModelsModule();
    let mode: InstallMode =
      opts.mode ?? job.defaultMode ?? (job.sourceUrl ? 'move' : 'copy');
    if (mode === 'link' && !job.allowLink && !job.localPath) {
      mode = 'copy';
    }

    const result = models.installModelFile(sourcePath, opts.type, mode);
    job.dest = result.dest;
    job.filename = result.filename;
    job.linkType = result.linkType;

    if (opts.family && (opts.type === 'checkpoint' || opts.type === 'diffusion')) {
      models.saveCheckpointFamily(result.filename, opts.family);
      invalidatePresetCache();
    }

    // Settings → Models → Civitai auto-fetch: trigger words + preview sidecars
    if (loadServerSettings().civitaiAutoFetch) {
      const dl = await loadDownloadModule();
      if (job.sourceUrl) {
        try {
          await dl.saveModelSidecars(result.dest, {
            triggerWords: job.triggerWords,
            previewUrl: job.previewUrl,
            sourceUrl: job.sourceUrl,
            modelName: job.modelName,
            baseModel: job.baseModel,
            headers: job.headers,
          });
        } catch {
          // sidecars are best-effort
        }
      } else {
        // Local file / upload: identify by hash in the background (hashing GBs takes a while)
        void dl.fetchCivitaiSidecarsByHash(result.dest).catch(() => {});
      }
    }

    // Clean upload copy if we copied from upload cache (not local path / not link)
    if (
      mode === 'copy' &&
      job.tempPath &&
      !job.localPath &&
      job.tempPath.startsWith(uploadDir)
    ) {
      try {
        fs.rmSync(job.tempPath, { force: true });
      } catch {
        // ignore
      }
    }

    job.status = 'done';
    job.progress = 100;
    invalidateModelCatalog();
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : String(err);
  }
  return job;
}

export async function listInstalledModels(type?: string) {
  const models = await loadModelsModule();
  return models.listModels(type);
}

export async function listModelTypeOptions() {
  const st = await loadSafetensorsModule();
  return st.MODEL_TYPE_OPTIONS;
}
