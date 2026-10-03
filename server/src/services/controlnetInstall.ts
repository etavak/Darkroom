import { randomUUID } from 'node:crypto';
import { cliUrl } from './cliShared.js';
import { invalidateModelCatalog, listModelCatalog } from './modelLists.js';

type CatalogEntry = {
  id: string;
  type: string;
  filename: string;
  url: string;
  sizeBytes: number;
  sha256: string;
  gated?: boolean;
  licenseUrl?: string;
  notes?: string;
  title?: string;
  arch?: string[];
  guides?: string[];
  recommended?: boolean;
};

export type ControlNetOption = {
  id: string;
  title: string;
  filename: string;
  sizeBytes: number;
  guides: string[];
  notes: string | null;
  licenseUrl: string | null;
  nonCommercial: boolean;
  recommended: boolean;
  installed: boolean;
};

export type ControlNetInstallJob = {
  id: string;
  componentId: string;
  title: string;
  status: 'running' | 'done' | 'error';
  progress: number;
  error?: string;
};

async function loadLib() {
  const url = (rel: string) => cliUrl(`lib/${rel}`);
  const cn = (await import(url('controlnetModels.js'))) as {
    FAMILY_ARCH: Record<string, string>;
    controlNetCatalog: () => CatalogEntry[];
    installedControlNetIds: (installed?: Array<{ name: string }>) => Set<string>;
  };
  const dep = (await import(url('dependencies.js'))) as {
    downloadAndInstallComponent: (comp: CatalogEntry, opts?: { quiet?: boolean; onProgress?: (done: number, total: number) => void }) => Promise<{ dest: string; filename: string }>;
  };
  return { ...cn, ...dep };
}

/** The curated ControlNet downloads that fit a family, with what's already installed. */
export async function controlNetOptions(familyId: string | null): Promise<{ arch: string | null; items: ControlNetOption[] }> {
  const lib = await loadLib();
  const arch = familyId ? lib.FAMILY_ARCH[familyId] ?? null : null;
  const catalog = await listModelCatalog().catch(() => null);
  const installed = lib.installedControlNetIds((catalog?.controlnet ?? []).map((name) => ({ name })));
  const items = lib
    .controlNetCatalog()
    .filter((c) => !arch || c.arch?.includes(arch))
    .map((c) => ({
      id: c.id,
      title: c.title ?? c.filename,
      filename: c.filename,
      sizeBytes: c.sizeBytes,
      guides: c.guides ?? [],
      notes: c.notes ?? null,
      licenseUrl: c.licenseUrl ?? null,
      nonCommercial: Boolean(c.licenseUrl?.includes('FLUX.1-dev')),
      recommended: Boolean(c.recommended),
      installed: installed.has(c.id),
    }));
  return { arch, items };
}

const jobs = new Map<string, ControlNetInstallJob>();

/** Downloads one catalog ControlNet (sha256-checked) into ComfyUI's controlnet folder. */
export async function startControlNetInstall(componentId: string): Promise<ControlNetInstallJob> {
  for (const j of jobs.values()) {
    if (j.componentId === componentId && j.status === 'running') return j;
  }
  const lib = await loadLib();
  const comp = lib.controlNetCatalog().find((c) => c.id === componentId);
  if (!comp) throw new Error('Unknown ControlNet model');
  const job: ControlNetInstallJob = { id: randomUUID(), componentId, title: comp.title ?? comp.filename, status: 'running', progress: 0 };
  jobs.set(job.id, job);
  void (async () => {
    try {
      await lib.downloadAndInstallComponent(comp, {
        quiet: true,
        onProgress: (done, total) => {
          job.progress = Math.min(99, total > 0 ? (done / total) * 100 : 0);
        },
      });
      job.progress = 100;
      job.status = 'done';
      invalidateModelCatalog();
    } catch (err) {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
    }
  })();
  return job;
}

/** Downloads the face finder for the face detailer and whitelists it for Impact Subpack. */
export async function startFaceModelInstall(): Promise<ControlNetInstallJob> {
  for (const j of jobs.values()) {
    if (j.componentId === 'face_yolov8m' && j.status === 'running') return j;
  }
  const url = cliUrl('lib/faceDetailer.js');
  const lib = (await import(url)) as { installFaceModel: (o?: { onProgress?: (d: number, t: number) => void }) => Promise<unknown> };
  const job: ControlNetInstallJob = { id: randomUUID(), componentId: 'face_yolov8m', title: 'Face finder', status: 'running', progress: 0 };
  jobs.set(job.id, job);
  void (async () => {
    try {
      await lib.installFaceModel({
        onProgress: (done, total) => {
          job.progress = Math.min(99, total > 0 ? (done / total) * 100 : 0);
        },
      });
      job.progress = 100;
      job.status = 'done';
      invalidateModelCatalog();
    } catch (err) {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
    }
  })();
  return job;
}

export function getControlNetInstallJob(id: string): ControlNetInstallJob | null {
  return jobs.get(id) ?? null;
}
