import { getObjectInfo } from '../services/comfyClient.js';

let cached: Record<string, unknown> | null = null;
let cachedAt = 0;
const TTL_MS = 30_000;

export async function loadObjectInfo(force = false): Promise<Record<string, unknown>> {
  if (!force && cached && Date.now() - cachedAt < TTL_MS) return cached;
  cached = await getObjectInfo();
  cachedAt = Date.now();
  return cached;
}

/** Something was installed: the next read fetches object_info fresh. */
export function invalidateObjectInfo(): void {
  cached = null;
}

/** Pick the first class name that exists in object_info. Never invent names. */
export function resolveNodeClass(
  objectInfo: Record<string, unknown>,
  candidates: string[],
): string | null {
  for (const name of candidates) {
    if (name && objectInfo[name] != null) return name;
  }
  return null;
}

export function requireNodeClass(
  objectInfo: Record<string, unknown>,
  candidates: string[],
  label: string,
): string {
  const found = resolveNodeClass(objectInfo, candidates);
  if (!found) {
    throw new Error(
      `Missing ComfyUI node for ${label}. Looked for: ${candidates.join(', ')}. ` +
        `Install the matching custom nodes / update ComfyUI.`,
    );
  }
  return found;
}

/**
 * A dropdown input's choices. ComfyUI describes them two ways: the classic
 * `[[...options], {...}]`, and the newer node schema's `["COMBO", { options: [...] }]`
 * (UpscaleModelLoader already uses it; more nodes are moving over).
 */
export function comboOptions(objectInfo: Record<string, unknown>, node: string, inputKey: string): string[] {
  type Inputs = Record<string, unknown> | undefined;
  const n = objectInfo[node] as { input?: { required?: Inputs; optional?: Inputs } } | undefined;
  const raw = n?.input?.required?.[inputKey] ?? n?.input?.optional?.[inputKey];
  if (!Array.isArray(raw)) return [];
  const list = Array.isArray(raw[0]) ? raw[0] : raw[0] === 'COMBO' ? (raw[1] as { options?: unknown } | undefined)?.options : null;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
}

export function hasNodeClass(objectInfo: Record<string, unknown>, candidates: string[]): boolean {
  return resolveNodeClass(objectInfo, candidates) != null;
}
