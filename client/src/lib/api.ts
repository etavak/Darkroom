import type {
  DependencyAnalysis,
  DependencyPlan,
  GenerationRecord,
  GenerationSettings,
  GenerateResponse,
  ModelCatalog,
  ModelInstallJob,
  SystemStatsSummary,
} from '../types/generation';
import type { FamilySummary, ResolvedPresets, TagSuggestion } from '../types/presets';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function fetchCheckpoints(): Promise<{ checkpoints: string[] }> {
  return request('/api/checkpoints');
}

export function fetchModels(): Promise<ModelCatalog> {
  return request('/api/models');
}

export function fetchSystemStats(): Promise<SystemStatsSummary> {
  return request('/api/models/system');
}

export function fetchModelTypes(): Promise<{ types: Array<{ value: string; label: string }> }> {
  return request('/api/models/types');
}

export function resolveModelUrlApi(url: string): Promise<ModelInstallJob> {
  return request('/api/models/resolve', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export function startModelDownloadApi(
  jobId: string,
  candidatePath?: string,
): Promise<ModelInstallJob> {
  return request('/api/models/download', {
    method: 'POST',
    body: JSON.stringify({ jobId, candidatePath }),
  });
}

export function fetchModelJob(jobId: string): Promise<ModelInstallJob> {
  return request(`/api/models/jobs/${encodeURIComponent(jobId)}`);
}

export async function uploadModelFileApi(file: File): Promise<ModelInstallJob> {
  const res = await fetch(`/api/models/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await res.json()) as ModelInstallJob;
}

export function detectModelPathApi(filePath: string): Promise<ModelInstallJob> {
  return request('/api/models/from-path', {
    method: 'POST',
    body: JSON.stringify({ path: filePath }),
  });
}

export function confirmModelInstallApi(body: {
  jobId: string;
  type: string;
  family?: string;
  mode?: 'copy' | 'move' | 'link';
}): Promise<ModelInstallJob> {
  return request('/api/models/install', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function analyzeDependenciesApi(body: {
  familyId: string;
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
}): Promise<DependencyAnalysis> {
  return request('/api/models/dependencies/analyze', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function createDependencyPlanApi(body: {
  familyId: string;
  choices: Array<{
    role: string;
    action: 'download' | 'skip' | 'local';
    componentId?: string;
    localPath?: string;
    mode?: 'copy' | 'move' | 'link';
  }>;
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
  hfToken?: string;
}): Promise<DependencyPlan> {
  return request('/api/models/dependencies/plan', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function executeDependencyPlanApi(body: {
  planId: string;
  hfToken?: string;
}): Promise<DependencyPlan> {
  return request('/api/models/dependencies/execute', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function fetchDependencyPlan(planId: string): Promise<DependencyPlan> {
  return request(`/api/models/dependencies/plans/${encodeURIComponent(planId)}`);
}

export function saveHfTokenApi(token: string): Promise<{ ok: boolean }> {
  return request('/api/models/hf-token', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export function fetchHealth(): Promise<{
  ok: boolean;
  comfy: boolean;
  comfyUrl: string;
  mock?: boolean;
  mode?: 'local' | 'remote';
}> {
  return request('/api/health');
}

export function startComfyApi(): Promise<{ ok: boolean; alreadyRunning?: boolean }> {
  return request('/api/comfy/start', { method: 'POST', body: '{}' });
}

export function startGenerate(
  settings: GenerationSettings & { previewMethod?: 'latent2rgb' | 'taesd' },
): Promise<GenerateResponse> {
  return request('/api/generate', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}

export type PreviewSettingsInfo = {
  supportsPerPromptPreview: boolean;
  launchPreviewMethod: string;
};

export function fetchPreviewSettings(): Promise<PreviewSettingsInfo> {
  return request('/api/settings/preview');
}

export function updatePreviewQuality(quality: 'fast' | 'detailed'): Promise<PreviewSettingsInfo> {
  return request('/api/settings/preview', {
    method: 'PUT',
    body: JSON.stringify({ quality }),
  });
}

export function fetchServerSettings(): Promise<
  import('../types/serverSettings').ServerSettingsResponse
> {
  return request('/api/settings');
}

export function updateServerSettings(
  partial: Partial<import('../types/serverSettings').ServerSettings>,
): Promise<import('../types/serverSettings').ServerSettingsResponse> {
  return request('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(partial),
  });
}

export function fetchDiagnostics(): Promise<{
  text: string;
  diskUsage: import('../types/serverSettings').DiskUsageInfo;
}> {
  return request('/api/settings/diagnostics');
}

export function runBackupApi(): Promise<{
  ok: boolean;
  path?: string;
  diskUsage?: import('../types/serverSettings').DiskUsageInfo;
}> {
  return request('/api/settings/backup', { method: 'POST' });
}

export function cancelGenerate(jobId: string | null): Promise<{ ok: boolean }> {
  return request('/api/generate/cancel', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  });
}

export function fetchHistory(): Promise<{ items: GenerationRecord[] }> {
  return request('/api/history');
}

export function fetchHistoryItem(id: string): Promise<GenerationRecord> {
  return request(`/api/history/${id}`);
}

export function deleteHistoryItem(id: string): Promise<void> {
  return request(`/api/history/${id}`, { method: 'DELETE' });
}

export function imageUrl(filename: string): string {
  return `/api/images/${encodeURIComponent(filename)}`;
}

export function fetchFamilies(): Promise<{ items: FamilySummary[] }> {
  return request('/api/presets/families');
}

export function resolvePresetsApi(body: {
  checkpoint: string;
  styleId: string | null;
  dismissedPositive: string[];
  dismissedNegative: string[];
  userPositive: string;
  userNegative: string;
}): Promise<ResolvedPresets> {
  return request('/api/presets/resolve', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function mapCheckpointFamily(
  filename: string,
  family: string,
): Promise<{ family: string }> {
  return request(`/api/presets/checkpoints/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: JSON.stringify({ family }),
  });
}

export function searchTagsApi(params: {
  q: string;
  family: string;
  limit?: number;
}): Promise<{
  suggestions: TagSuggestion[];
  enabled: boolean;
  tagFormat: 'spaces' | 'underscores';
}> {
  const qs = new URLSearchParams({
    q: params.q,
    family: params.family,
  });
  if (params.limit != null) qs.set('limit', String(params.limit));
  return request(`/api/tags?${qs.toString()}`);
}

export function validateTagsApi(body: {
  family: string;
  tags: string[];
}): Promise<{ unknown: string[]; enabled: boolean }> {
  return request('/api/tags/validate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
