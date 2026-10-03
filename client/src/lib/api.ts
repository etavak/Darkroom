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
import type { FamilySummary, ResolvedPresets, TagCategory, TagSuggestion } from '../types/presets';

/** Fired when the server wants the LAN PIN (another device, or the PIN was regenerated). */
export const AUTH_REQUIRED_EVENT = 'darkroom:auth-required';

/** Throw the server's error message; signal the PIN screen on auth_required. */
async function throwForResponse(res: Response): Promise<never> {
  let message = res.statusText;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // ignore
  }
  if (res.status === 401 && message === 'auth_required') {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
  throw new Error(message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) await throwForResponse(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type AuthStatus = { local: boolean; authorized: boolean };

export function fetchAuthStatus(): Promise<AuthStatus> {
  return request('/api/auth/status');
}

export function submitLanPin(pin: string): Promise<{ ok: boolean }> {
  return request('/api/auth/pin', { method: 'POST', body: JSON.stringify({ pin }) });
}

/** pin rotates every periodS seconds (authenticator-style); expiresInMs until the next one */
export type LanAccessInfo = { pin: string; urls: string[]; expiresInMs?: number; periodS?: number };

/** PIN + LAN URLs; only answers on the computer running Darkroom. */
export function fetchLanAccess(): Promise<LanAccessInfo> {
  return request('/api/auth/lan');
}

export function regenerateLanPin(): Promise<LanAccessInfo> {
  return request('/api/auth/lan/regenerate', { method: 'POST', body: '{}' });
}

export type LanDevice = { id: string; device: string; createdAt: number; lastSeen: number };

/** Devices signed in with the PIN; only answers on the computer running Darkroom. */
export function fetchLanDevices(): Promise<{ items: LanDevice[] }> {
  return request('/api/auth/devices');
}

export function revokeLanDevice(id: string): Promise<{ ok: boolean }> {
  return request(`/api/auth/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** This device signs itself out (it will need the PIN again). */
export function signOutThisDevice(): Promise<{ ok: boolean }> {
  return request('/api/auth/signout', { method: 'POST', body: '{}' });
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
  if (!res.ok) await throwForResponse(res);
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

export type LoraMeta = {
  name: string;
  title: string | null;
  base: string | null;
  family: string | null;
  arch: 'sd15' | 'sdxl' | 'sd3' | 'flux' | 'flux2' | null;
  triggers: string[];
  thumb: boolean;
};

export function fetchLoraMeta(): Promise<{ items: LoraMeta[] }> {
  return request('/api/models/loras/meta');
}

export const loraThumbUrl = (name: string) => `/api/models/loras/thumb?name=${encodeURIComponent(name)}`;

export function emptyTrashApi(): Promise<{
  ok: boolean;
  removed: number;
  diskUsage: import('../types/serverSettings').DiskUsageInfo;
}> {
  return request('/api/settings/trash/empty', { method: 'POST' });
}

export type VersionInfo = { version: string; sha: string | null; updatedAt: string | null; git: boolean };
export type UpdateCheck = VersionInfo & { latest: string | null; updateAvailable: boolean | null; checkedAt: string; error?: string };

export function fetchVersionInfo(): Promise<VersionInfo> {
  return request('/api/settings/version');
}

export function checkUpdatesApi(force = false): Promise<UpdateCheck> {
  return request(`/api/settings/updates${force ? '?force=1' : ''}`);
}

export function testEnhanceApi(): Promise<{ ok: boolean; message: string }> {
  return request('/api/prompt/enhance/test', { method: 'POST' });
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
  qualityPreset?: string | null;
  negativePreset?: string | null;
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
}): Promise<{ unknown: string[]; categories?: Record<string, TagCategory>; enabled: boolean }> {
  return request('/api/tags/validate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function fetchWildcards(): Promise<{
  folder: string;
  items: Array<{ name: string; relative: string }>;
}> {
  return request('/api/prompt/wildcards');
}

/** family: tag-trained families get tags back, others a description */
export function enhancePromptApi(prompt: string, family?: string | null): Promise<{ prompt: string }> {
  return request('/api/prompt/enhance', {
    method: 'POST',
    body: JSON.stringify({ prompt, family: family ?? undefined }),
  });
}

/** A random starting prompt that suits the family (its own tags, or a sentence). */
export function fetchRandomPrompt(family?: string | null): Promise<{ prompt: string }> {
  const qs = family ? `?family=${encodeURIComponent(family)}` : '';
  return request(`/api/prompt/random${qs}`);
}

export type SourceUploadResult = {
  localName: string;
  comfyName: string;
  width: number;
  height: number;
  url: string;
};

export async function uploadSourceApi(file: File): Promise<SourceUploadResult> {
  const res = await fetch(`/api/source/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!res.ok) await throwForResponse(res);
  return (await res.json()) as SourceUploadResult;
}

export function uploadSourceFromGalleryApi(filename: string): Promise<SourceUploadResult> {
  return request('/api/source/from-gallery', {
    method: 'POST',
    body: JSON.stringify({ filename }),
  });
}
