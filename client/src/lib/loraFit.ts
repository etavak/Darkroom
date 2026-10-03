import type { LoraMeta } from '@/lib/api';

/** Architecture of each family: a LoRA only loads on a model of the same one. */
const FAMILY_ARCH: Record<string, string> = {
  sd15: 'sd15',
  sdxl: 'sdxl',
  illustrious: 'sdxl',
  noobai: 'sdxl',
  'noobai-vpred': 'sdxl',
  pony: 'sdxl',
  sd3: 'sd3',
  flux: 'flux',
  'flux-kontext': 'flux',
  'flux2-klein': 'flux2',
  anima: 'anima',
};

/** Families whose LoRAs work on each other (NoobAI is trained from Illustrious). */
const GROUP: Record<string, string> = {
  illustrious: 'illustrious',
  noobai: 'illustrious',
  'noobai-vpred': 'illustrious',
  flux: 'flux',
  'flux-kontext': 'flux',
};
const group = (f: string) => GROUP[f] ?? f;

export type LoraFit = { kind: 'ok' | 'unknown' | 'other-base' | 'wrong-arch'; note: string | null };

/**
 * How well a LoRA suits the current model. "other-base" still loads (same architecture)
 * but may look off; "wrong-arch" won't load at all.
 */
export function loraFit(meta: LoraMeta | undefined, familyId: string | null, familyName: string | null): LoraFit {
  if (!meta?.arch || !familyId) return { kind: 'unknown', note: null };
  const arch = FAMILY_ARCH[familyId];
  if (arch && meta.arch !== arch) {
    return { kind: 'wrong-arch', note: `Made for ${meta.base ?? meta.arch} — it won’t work with ${familyName ?? 'this model'}` };
  }
  if (meta.family && meta.family !== familyId && group(meta.family) !== group(familyId) && familyId !== 'sdxl') {
    return { kind: 'other-base', note: `Made for ${meta.base} — may not suit ${familyName ?? 'this model'}` };
  }
  return { kind: 'ok', note: null };
}

/** The prompt's comma-separated parts, trimmed and lower-cased (for trigger-word checks). */
const parts = (prompt: string) => prompt.split(',').map((p) => p.trim().toLowerCase());

export const promptHasTag = (prompt: string, tag: string) => parts(prompt).includes(tag.trim().toLowerCase());

/** Adds the trigger word at the end, or removes it when it's already in the prompt. */
export function togglePromptTag(prompt: string, tag: string): string {
  const t = tag.trim();
  if (promptHasTag(prompt, t)) {
    return prompt
      .split(',')
      .filter((p) => p.trim().toLowerCase() !== t.toLowerCase())
      .join(',')
      .replace(/^\s*,\s*|\s*,\s*$/g, '')
      .trim();
  }
  const base = prompt.trimEnd();
  return base ? `${base.replace(/,\s*$/, '')}, ${t}` : t;
}
