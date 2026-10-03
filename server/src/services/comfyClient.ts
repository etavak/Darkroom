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

/** Readable text for ComfyUI's /prompt rejections (they arrive as JSON). */
export function describeQueueError(status: number, text: string): string {
  type NodeError = { class_type?: string; errors?: Array<{ message?: string; details?: string }> };
  let body: { error?: { type?: string; message?: string; extra_info?: { class_type?: string } }; node_errors?: Record<string, NodeError> } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    return `ComfyUI rejected the job (${status}): ${text.slice(0, 300)}`;
  }
  const err = body?.error;
  if (err?.type === 'missing_node_type') {
    const node = err.extra_info?.class_type ?? 'a node';
    return `ComfyUI doesn't have the “${node}” node — the custom node that provides it isn't installed or didn't load. Install it, then restart ComfyUI.`;
  }
  const first = Object.values(body?.node_errors ?? {})[0];
  const detail = first?.errors?.[0];
  if (detail) {
    return `ComfyUI rejected the job: ${first.class_type ? `${first.class_type} — ` : ''}${detail.message ?? ''}${detail.details ? ` (${detail.details})` : ''}`;
  }
  return `ComfyUI rejected the job (${status}): ${err?.message ?? text.slice(0, 300)}`;
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
    throw new ComfyError(describeQueueError(res.status, text), res.status);
  }
  return (await res.json()) as { prompt_id: string; number: number };
}

/** prompt_ids ComfyUI is running now vs. still waiting to run. */
export async function getQueueState(): Promise<{ running: Set<string>; pending: Set<string> }> {
  const res = await comfyFetch('/queue');
  if (!res.ok) {
    throw new ComfyError(`queue failed: ${res.status}`, res.status);
  }
  const data = (await res.json()) as {
    queue_running?: unknown[][];
    queue_pending?: unknown[][];
  };
  // Entries are [number, prompt_id, prompt, extra_data, outputs]
  const ids = (entries: unknown[][] | undefined) =>
    new Set(
      (entries ?? [])
        .map((e) => (Array.isArray(e) ? e[1] : undefined))
        .filter((id): id is string => typeof id === 'string'),
    );
  return { running: ids(data.queue_running), pending: ids(data.queue_pending) };
}

/**
 * Where a prompt is in ComfyUI's queue: running, waiting (with how many jobs are ahead —
 * including ones from other apps), or not there.
 */
export async function getPromptQueuePosition(promptId: string): Promise<{ state: 'running' | 'pending' | 'absent'; ahead: number; running: number }> {
  const res = await comfyFetch('/queue');
  if (!res.ok) throw new ComfyError(`queue failed: ${res.status}`, res.status);
  const data = (await res.json()) as { queue_running?: unknown[][]; queue_pending?: unknown[][] };
  const running = data.queue_running ?? [];
  if (running.some((e) => Array.isArray(e) && e[1] === promptId)) return { state: 'running', ahead: 0, running: running.length };
  // Pending entries run in order of their number
  const pending = [...(data.queue_pending ?? [])].filter(Array.isArray).sort((a, b) => Number(a[0]) - Number(b[0]));
  const at = pending.findIndex((e) => e[1] === promptId);
  if (at < 0) return { state: 'absent', ahead: 0, running: running.length };
  return { state: 'pending', ahead: at + running.length, running: running.length };
}

/** prompt_ids currently running or waiting in ComfyUI's queue. */
export async function getQueuedPromptIds(): Promise<Set<string>> {
  const { running, pending } = await getQueueState();
  return new Set([...running, ...pending]);
}

/** Remove not-yet-started prompts from ComfyUI's queue. */
export async function deleteQueuedPrompts(promptIds: string[]): Promise<void> {
  const res = await comfyFetch('/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: promptIds }),
  });
  if (!res.ok) {
    throw new ComfyError(`queue delete failed: ${res.status}`, res.status);
  }
}

/**
 * Cancel one prompt without touching other jobs: interrupt only if it is the one
 * running, otherwise drop it from the pending queue.
 */
export async function cancelPrompt(promptId: string): Promise<'interrupted' | 'dequeued' | 'not_queued'> {
  const { running, pending } = await getQueueState();
  if (running.has(promptId)) {
    await interrupt();
    return 'interrupted';
  }
  if (pending.has(promptId)) {
    await deleteQueuedPrompts([promptId]);
    return 'dequeued';
  }
  return 'not_queued';
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

/** Upload an image into ComfyUI's input folder. Returns the filename Comfy expects. */
export async function uploadImage(buf: Buffer, filename: string): Promise<string> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'source.png';
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(buf)]), safe);
  form.append('overwrite', 'true');
  const res = await comfyFetch('/upload/image', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ComfyError(`upload image failed: ${res.status} ${text}`, res.status);
  }
  const data = (await res.json()) as { name?: string; filename?: string };
  return data.name || data.filename || safe;
}
