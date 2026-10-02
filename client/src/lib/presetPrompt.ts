import type { InjectedTag } from '@/types/presets';

function tagKey(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Remove leading preset-injected tags from a final prompt (preset tags + user text),
 * recovering the user's own text from history records that predate `userPrompt`.
 */
export function stripInjectedTags(finalPrompt: string, injected: InjectedTag[]): string {
  if (injected.length === 0) return finalPrompt;
  const keys = new Set(injected.map((t) => tagKey(t.tag)));
  const parts = finalPrompt.split(',');
  let i = 0;
  while (i < parts.length && keys.has(tagKey(parts[i]))) i++;
  return parts.slice(i).join(',').trim();
}
