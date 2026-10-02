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

export function hasNodeClass(objectInfo: Record<string, unknown>, candidates: string[]): boolean {
  return resolveNodeClass(objectInfo, candidates) != null;
}
