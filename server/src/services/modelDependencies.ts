import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { upsertEnvValue } from './envSettings.js';
import { invalidateModelCatalog } from './modelLists.js';
import { repoRoot } from './cliShared.js';

function depUrl(): string {
  return pathToFileURL(path.join(repoRoot, 'scripts/cli/lib/dependencies.js')).href;
}

export type DependencyOption = {
  id: string;
  filename: string;
  type: string;
  notes?: string;
  sizeBytes: number;
  sha256: string;
  gated: boolean;
  licenseUrl?: string;
  recommended: boolean;
};

export type RoleAnalysis = {
  role: string;
  required: boolean;
  status: 'satisfied' | 'missing' | 'choice';
  satisfiedBy?: { filename: string; path: string };
  options: DependencyOption[];
  preselected?: string | null;
};

export type DependencyAnalysis = {
  familyId: string;
  vramGB: number | null;
  roles: RoleAnalysis[];
  freeDiskBytes: number | null;
  freeDiskLabel: string;
};

export type RoleChoice = {
  role: string;
  action: 'download' | 'skip' | 'local';
  componentId?: string;
  localPath?: string;
  mode?: 'copy' | 'move' | 'link';
};

export type DependencyPlanItem = {
  role: string;
  action: 'download' | 'local';
  type: string;
  filename: string;
  sizeBytes: number;
  gated: boolean;
  licenseUrl?: string;
  notes?: string;
  componentId?: string;
  localPath?: string;
  mode?: 'copy' | 'move' | 'link';
};

export type DependencyPlan = {
  id: string;
  familyId: string;
  items: DependencyPlanItem[];
  totalBytes: number;
  totalLabel: string;
  freeDiskBytes: number | null;
  freeDiskLabel: string;
  gatedLicenseUrls: string[];
  needsHfToken: boolean;
  status: 'ready' | 'running' | 'done' | 'error';
  progress: number;
  currentFile?: string;
  error?: string;
  completed: string[];
  extras?: Array<{
    id: string;
    type: string;
    filename: string;
    url: string;
    sizeBytes: number;
    sha256: string;
    gated?: boolean;
    notes?: string;
  }>;
};

const plans = new Map<string, DependencyPlan & { _rawItems?: unknown[] }>();

async function loadDeps() {
  return import(depUrl()) as Promise<{
    analyzeDependencies: (
      familyId: string,
      opts?: {
        vramGB?: number | null;
        extras?: Array<{
          id: string;
          type: string;
          filename: string;
          url: string;
          sizeBytes: number;
          sha256: string;
          gated?: boolean;
          notes?: string;
        }>;
      },
    ) => DependencyAnalysis;
    buildDependencyPlan: (
      familyId: string,
      choices: RoleChoice[],
      opts?: { extras?: DependencyPlan['extras'] },
    ) => {
      familyId: string;
      items: Array<{
        role: string;
        action: 'download' | 'local';
        component?: {
          id: string;
          type: string;
          filename: string;
          url: string;
          sizeBytes: number;
          sha256: string;
          gated?: boolean;
          licenseUrl?: string;
          notes?: string;
        };
        localPath?: string;
        mode?: 'copy' | 'move' | 'link';
        type: string;
        filename: string;
        sizeBytes: number;
        gated: boolean;
        licenseUrl?: string;
        notes?: string;
      }>;
      totalBytes: number;
      totalLabel: string;
      freeDiskBytes: number | null;
      freeDiskLabel: string;
      gatedLicenseUrls: string[];
      needsHfToken: boolean;
    };
    detectVramGB: () => Promise<number | null>;
    downloadAndInstallComponent: (
      comp: {
        id: string;
        type: string;
        filename: string;
        url: string;
        sizeBytes: number;
        sha256: string;
        gated?: boolean;
        licenseUrl?: string;
      },
      opts?: {
        hfToken?: string;
        onProgress?: (t: number, total: number) => void;
        quiet?: boolean;
      },
    ) => Promise<{ dest: string; filename: string }>;
    installLocalDependency: (
      localPath: string,
      type: string,
      mode: 'copy' | 'move' | 'link',
    ) => { dest: string; filename: string };
    ensureHfToken: (token?: string, opts?: { save?: boolean }) => string | null;
    loadComponents: () => Map<string, unknown>;
  }>;
}

export async function analyzeModelDependencies(opts: {
  familyId: string;
  vramGB?: number | null;
  extras?: DependencyPlan['extras'];
}): Promise<DependencyAnalysis> {
  const dep = await loadDeps();
  const vramGB = opts.vramGB ?? (await dep.detectVramGB());
  return dep.analyzeDependencies(opts.familyId || '_companions', {
    vramGB,
    extras: opts.extras,
  });
}

export async function createDependencyPlan(opts: {
  familyId: string;
  choices: RoleChoice[];
  extras?: DependencyPlan['extras'];
  hfToken?: string;
}): Promise<DependencyPlan> {
  const dep = await loadDeps();
  if (opts.hfToken) {
    dep.ensureHfToken(opts.hfToken, { save: true });
    upsertEnvValue('HF_TOKEN', opts.hfToken.trim());
  }
  const built = dep.buildDependencyPlan(opts.familyId || '_companions', opts.choices, {
    extras: opts.extras,
  });
  const id = randomUUID();
  const plan: DependencyPlan & { _rawItems?: unknown[] } = {
    id,
    familyId: built.familyId,
    items: built.items.map((i) => ({
      role: i.role,
      action: i.action,
      type: i.type,
      filename: i.filename,
      sizeBytes: i.sizeBytes,
      gated: i.gated,
      licenseUrl: i.licenseUrl,
      notes: i.notes,
      componentId: i.component?.id,
      localPath: i.localPath,
      mode: i.mode,
    })),
    totalBytes: built.totalBytes,
    totalLabel: built.totalLabel,
    freeDiskBytes: built.freeDiskBytes,
    freeDiskLabel: built.freeDiskLabel,
    gatedLicenseUrls: built.gatedLicenseUrls,
    needsHfToken: built.needsHfToken,
    status: 'ready',
    progress: 0,
    completed: [],
    extras: opts.extras,
    _rawItems: built.items,
  };
  plans.set(id, plan);
  return sanitizePlan(plan);
}

function sanitizePlan(plan: DependencyPlan & { _rawItems?: unknown[] }): DependencyPlan {
  const { _rawItems: _, ...rest } = plan;
  return rest;
}

export function getDependencyPlan(id: string): DependencyPlan | null {
  const plan = plans.get(id);
  return plan ? sanitizePlan(plan) : null;
}

export async function executeDependencyPlan(
  planId: string,
  opts?: { hfToken?: string },
): Promise<DependencyPlan> {
  const plan = plans.get(planId);
  if (!plan) throw new Error('Unknown plan');
  if (plan.status === 'running') return sanitizePlan(plan);

  const dep = await loadDeps();
  if (opts?.hfToken) {
    dep.ensureHfToken(opts.hfToken, { save: true });
    upsertEnvValue('HF_TOKEN', opts.hfToken.trim());
  }

  if (plan.needsHfToken && !dep.ensureHfToken()) {
    plan.status = 'error';
    plan.error = `HF_TOKEN required. Accept license(s): ${plan.gatedLicenseUrls.join(', ')}`;
    return sanitizePlan(plan);
  }

  plan.status = 'running';
  plan.progress = 0;
  plan.error = undefined;

  const rawItems = (plan._rawItems || []) as Array<{
    role: string;
    action: 'download' | 'local';
    component?: {
      id: string;
      type: string;
      filename: string;
      url: string;
      sizeBytes: number;
      sha256: string;
      gated?: boolean;
      licenseUrl?: string;
    };
    localPath?: string;
    mode?: 'copy' | 'move' | 'link';
    type: string;
    filename: string;
  }>;

  void (async () => {
    try {
      let done = 0;
      for (const item of rawItems) {
        plan.currentFile = item.filename;
        if (item.action === 'local' && item.localPath) {
          if (!fs.existsSync(item.localPath)) {
            throw new Error(`Local file missing: ${item.localPath}`);
          }
          const r = dep.installLocalDependency(
            item.localPath,
            item.type,
            item.mode || 'link',
          );
          plan.completed.push(r.filename);
        } else if (item.component) {
          await dep.downloadAndInstallComponent(item.component, {
            quiet: true,
            onProgress: (transferred, total) => {
              const filePct = total > 0 ? transferred / total : 0;
              plan.progress = Math.min(99, ((done + filePct) / rawItems.length) * 100);
            },
          });
          plan.completed.push(item.filename);
        }
        done += 1;
        plan.progress = Math.min(99, (done / rawItems.length) * 100);
      }
      plan.progress = 100;
      plan.status = 'done';
      plan.currentFile = undefined;
      invalidateModelCatalog();
    } catch (err) {
      plan.status = 'error';
      plan.error = err instanceof Error ? err.message : String(err);
    }
  })();

  return sanitizePlan(plan);
}

export function saveHfToken(token: string): void {
  const t = token.trim();
  if (!t) throw new Error('token required');
  upsertEnvValue('HF_TOKEN', t);
}
