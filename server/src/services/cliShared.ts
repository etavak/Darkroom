import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** file:// URL of a launcher module (the launcher's code lives in launcher/). */
export function cliUrl(rel: string): string {
  return pathToFileURL(path.join(repoRoot, 'launcher', rel)).href;
}

/**
 * Darkroom's runtime folder (portable tools, uploads, version file): dependencies/runtime,
 * or ./runtime on older installs that haven't been tidied up — same rule as the launcher.
 */
export function runtimeDir(): string {
  const next = path.join(repoRoot, 'dependencies', 'runtime');
  const legacy = path.join(repoRoot, 'runtime');
  return !fs.existsSync(next) && fs.existsSync(legacy) ? legacy : next;
}

export type GuessedModelType =
  | 'checkpoint'
  | 'diffusion'
  | 'text_encoder'
  | 'lora'
  | 'vae'
  | 'upscaler'
  | 'embedding'
  | 'controlnet'
  | 'unknown';

export async function loadSafetensorsModule(): Promise<{
  guessModelType: (filePath: string) => GuessedModelType;
  MODEL_TYPE_OPTIONS: Array<{ value: string; label: string }>;
  readSafetensorsHeader: (filePath: string) => { header: Record<string, unknown>; keys: string[] } | null;
}> {
  return import(cliUrl('lib/safetensors.js')) as Promise<{
    guessModelType: (filePath: string) => GuessedModelType;
    MODEL_TYPE_OPTIONS: Array<{ value: string; label: string }>;
    readSafetensorsHeader: (
      filePath: string,
    ) => { header: Record<string, unknown>; keys: string[] } | null;
  }>;
}

export async function loadDownloadModule(): Promise<{
  resolveModelUrl: (pageUrl: string) => Promise<{
    downloadUrl: string;
    filename: string;
    triggerWords: string[];
    previewUrl: string | null;
    modelName: string;
    baseModel?: string | null;
    headers?: Record<string, string>;
    candidates?: Array<{
      path: string;
      size: number;
      downloadUrl: string;
      filename: string;
    }>;
    companions?: Array<{
      path: string;
      size: number;
      downloadUrl: string;
      filename: string;
      fileType: string;
      sha256?: string;
    }>;
  }>;
  downloadFile: (
    url: string,
    destPath: string,
    opts?: {
      headers?: Record<string, string>;
      onProgress?: (transferred: number, total: number) => void;
      quiet?: boolean;
    },
  ) => Promise<{ destPath: string; bytes: number }>;
  downloadsCacheDir: () => string;
  saveModelSidecars: (
    dest: string,
    meta: {
      triggerWords?: string[];
      previewUrl?: string | null;
      sourceUrl?: string;
      modelName?: string;
      baseModel?: string | null;
      headers?: Record<string, string>;
    },
  ) => Promise<void>;
  formatBytes: (n: number) => string;
  fetchCivitaiSidecarsByHash: (modelDest: string) => Promise<boolean>;
}> {
  return import(cliUrl('lib/download.js')) as Promise<{
    resolveModelUrl: (pageUrl: string) => Promise<{
      downloadUrl: string;
      filename: string;
      triggerWords: string[];
      previewUrl: string | null;
      modelName: string;
      headers?: Record<string, string>;
      candidates?: Array<{
        path: string;
        size: number;
        downloadUrl: string;
        filename: string;
      }>;
      companions?: Array<{
        path: string;
        size: number;
        downloadUrl: string;
        filename: string;
        fileType: string;
        sha256?: string;
      }>;
    }>;
    downloadFile: (
      url: string,
      destPath: string,
      opts?: {
        headers?: Record<string, string>;
        onProgress?: (transferred: number, total: number) => void;
        quiet?: boolean;
      },
    ) => Promise<{ destPath: string; bytes: number }>;
    downloadsCacheDir: () => string;
    saveModelSidecars: (
      dest: string,
      meta: {
        triggerWords?: string[];
        previewUrl?: string | null;
        sourceUrl?: string;
        modelName?: string;
        baseModel?: string | null;
        headers?: Record<string, string>;
      },
    ) => Promise<void>;
    formatBytes: (n: number) => string;
    fetchCivitaiSidecarsByHash: (modelDest: string) => Promise<boolean>;
  }>;
}

export async function loadModelsModule(): Promise<{
  installModelFile: (
    src: string,
    type: string,
    mode: 'copy' | 'move' | 'link',
  ) => { dest: string; filename: string; linkType?: 'symlink' | 'hardlink' };
  saveCheckpointFamily: (filename: string, family: string) => void;
  listFamilies: () => Array<{
    id: string;
    name: string;
    supportsGguf?: boolean;
  }>;
  listModels: (type?: string) => Array<{
    type: string;
    name: string;
    path: string;
    size: number;
    family?: string;
    linkType?: 'symlink' | 'hardlink' | null;
    sourcePath?: string | null;
    broken?: boolean;
  }>;
  deleteModel: (filePath: string) => { removedLinkOnly: boolean };
  normalizeDraggedPath: (raw: string) => string;
}> {
  return import(cliUrl('lib/models.js')) as Promise<{
    installModelFile: (
      src: string,
      type: string,
      mode: 'copy' | 'move' | 'link',
    ) => { dest: string; filename: string; linkType?: 'symlink' | 'hardlink' };
    saveCheckpointFamily: (filename: string, family: string) => void;
    listFamilies: () => Array<{
      id: string;
      name: string;
      supportsGguf?: boolean;
    }>;
    listModels: (type?: string) => Array<{
      type: string;
      name: string;
      path: string;
      size: number;
      family?: string;
      linkType?: 'symlink' | 'hardlink' | null;
      sourcePath?: string | null;
      broken?: boolean;
    }>;
    deleteModel: (filePath: string) => { removedLinkOnly: boolean };
    normalizeDraggedPath: (raw: string) => string;
  }>;
}

export async function loadLinkInstallModule(): Promise<{
  defaultInstallMode: (src: string) => 'link' | 'copy' | 'move';
  isOutsideComfyModels: (src: string) => boolean;
}> {
  return import(cliUrl('lib/linkInstall.js')) as Promise<{
    defaultInstallMode: (src: string) => 'link' | 'copy' | 'move';
    isOutsideComfyModels: (src: string) => boolean;
  }>;
}

export async function loadComfyLauncherModule(): Promise<{
  startComfyProcess: () => { pid: number; logFile: string };
}> {
  return import(cliUrl('lib/comfy.js')) as Promise<{
    startComfyProcess: () => { pid: number; logFile: string };
  }>;
}

export { repoRoot };
