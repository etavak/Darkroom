/** Approximate CLIP-style token count (words / tags). 75 tokens ≈ one chunk. */
export function estimateTokenCount(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  // Split on commas and whitespace; count non-empty parts (A1111-ish tag heuristic)
  const parts = cleaned
    .split(/[,\n]+|\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length;
}

export function formatTokenChunks(count: number, chunkSize = 75): string {
  if (count === 0) return '0 tokens';
  const chunks = Math.max(1, Math.ceil(count / chunkSize));
  if (chunks === 1) return `${count} / ${chunkSize}`;
  return `${count} tokens · ${chunks}×${chunkSize}`;
}

export type PromptTokenMode = 'clip' | 'encoder';

export type TokenBudget = {
  mode: PromptTokenMode;
  max: number;
  /** Injected preset tag count (CLIP mode only). */
  presetCount?: number;
  /** User / remaining prompt text to count. */
  userText: string;
};

/** CLIP: "3 preset + N / 75". Encoder: "N / max". */
export function formatTokenBadge(budget: TokenBudget): { label: string; over: boolean } {
  const max = budget.max > 0 ? budget.max : 75;
  if (budget.mode === 'clip') {
    const preset = Math.max(0, budget.presetCount ?? 0);
    const user = estimateTokenCount(budget.userText);
    const total = preset + user;
    return {
      label: `${preset} preset + ${user} / ${max}`,
      over: total > max,
    };
  }
  const count = estimateTokenCount(budget.userText);
  return {
    label: `${count} / ${max}`,
    over: count > max,
  };
}
