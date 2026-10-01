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
