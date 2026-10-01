import type { GenerationRecord, GenerationSettings, GenerateResponse } from '../types/generation';
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
