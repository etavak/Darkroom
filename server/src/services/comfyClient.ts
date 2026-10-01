import { config } from '../config.js';

export class ComfyError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ComfyError';
  }
}

async function comfyFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${config.comfyUrl}${path}`;
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new ComfyError(
      `ComfyUI unreachable at ${config.comfyUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function pingComfy(): Promise<boolean> {
  try {
    const res = await comfyFetch('/system_stats');
    return res.ok;
  } catch {
    return false;
  }
}

export async function interrupt(): Promise<void> {
  const res = await comfyFetch('/interrupt', { method: 'POST' });
  if (!res.ok) {
    throw new ComfyError(`interrupt failed: ${res.status}`, res.status);
  }
}

export async function getObjectInfo(): Promise<Record<string, unknown>> {
  const res = await comfyFetch('/object_info');
  if (!res.ok) {
    throw new ComfyError(`object_info failed: ${res.status}`, res.status);
  }
  return (await res.json()) as Record<string, unknown>;
}

export async function queuePrompt(
  prompt: Record<string, unknown>,
  clientId: string,
  opts?: { previewMethod?: 'latent2rgb' | 'taesd' | 'none' | 'auto' },
): Promise<{ prompt_id: string; number: number }> {
  const body: Record<string, unknown> = {
    prompt,
    client_id: clientId,
  };
  if (opts?.previewMethod) {
    body.extra_data = { preview_method: opts.previewMethod };
  }
  const res = await comfyFetch('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ComfyError(`queue prompt failed: ${res.status} ${text}`, res.status);
  }
  return (await res.json()) as { prompt_id: string; number: number };
}

export async function getHistory(promptId: string): Promise<Record<string, unknown> | null> {
  const res = await comfyFetch(`/history/${promptId}`);
  if (!res.ok) {
    throw new ComfyError(`history failed: ${res.status}`, res.status);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const entry = data[promptId];
  return (entry as Record<string, unknown>) ?? null;
}

export async function viewImage(params: {
  filename: string;
  subfolder?: string;
  type?: string;
}): Promise<Buffer> {
  const qs = new URLSearchParams({
    filename: params.filename,
    subfolder: params.subfolder ?? '',
    type: params.type ?? 'output',
  });
  const res = await comfyFetch(`/view?${qs}`);
  if (!res.ok) {
    throw new ComfyError(`view failed: ${res.status}`, res.status);
  }
  return Buffer.from(await res.arrayBuffer());
}
