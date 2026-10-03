import type { GenerationRecord, GenerationSettings } from '@/types/generation';

/** A job that failed this session (failures aren't kept in History). */
export type FailedJob = {
  id: string;
  settings: GenerationSettings;
  label: string;
  error: string;
  at: number;
};

/** One row on the plane: a finished generation, the running job, or a failed one. */
export type PlaneEntry =
  | { kind: 'record'; key: string; record: GenerationRecord; images: string[]; pinned?: boolean }
  | { kind: 'running'; key: string; settings: GenerationSettings; previewUrl: string | null; progress: number }
  | { kind: 'failed'; key: string; failed: FailedJob };

export type Tile = {
  /** `${entry.key}:${index}` */
  id: string;
  entry: PlaneEntry;
  index: number;
  src: string | null;
  left: number;
  top: number;
  w: number;
  h: number;
};

/** World units per image pixel */
export const WORLD_SCALE = 0.42;
const S = WORLD_SCALE;
const BUF = 32;

/** Expected output size from the settings (upscale / hires / extend change it). */
export function outputSize(s: GenerationSettings): { w: number; h: number } {
  let w = s.width || 1024;
  let h = s.height || 1024;
  if (s.generationMode === 'upscale' && s.upscale?.scale) {
    w *= s.upscale.scale;
    h *= s.upscale.scale;
  } else if (s.hiresFix?.enabled && s.hiresFix.scale) {
    w *= s.hiresFix.scale;
    h *= s.hiresFix.scale;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/** Zoom that fits a w×h world box on screen with room for the toolbars. */
export function fitZoom(w: number, h: number, W: number, H: number): number {
  return Math.max(0.02, Math.min((W - 96) / w, (H - 76 - 76 - 24) / h, 3));
}

export function tileId(key: string, index: number): string {
  return `${key}:${index}`;
}

/**
 * Newest row on top, a batch side by side. Rows and neighbours are spaced so that when
 * one image is focused (fit to the screen) none of its neighbours peeks into view.
 */
export function layoutTiles(
  entries: PlaneEntry[],
  W: number,
  H: number,
  dims: Map<string, { w: number; h: number }>,
): Tile[] {
  const spareX = (t: { w: number; h: number }) => W / 2 / fitZoom(t.w, t.h, W, H) - t.w / 2;
  const reachY = (t: { w: number; h: number }) => H / 2 / fitZoom(t.w, t.h, W, H);

  // Images made from another one (inpaint, extend, vary, upscale…) join their original's row,
  // to its right, oldest first; the row keeps the original's place on the plane.
  const byKey = new Map(entries.filter((e) => e.kind === 'record').map((e) => [e.key, e]));
  const parentOf = (e: PlaneEntry): string | null =>
    e.kind === 'record' ? e.record.parentId ?? e.record.settings.parentId ?? null : e.kind === 'running' ? e.settings.parentId ?? null : e.failed.settings.parentId ?? null;
  const rootOf = (e: PlaneEntry): string => {
    let cur = e;
    for (let i = 0; i < 32; i++) {
      const pk = parentOf(cur);
      const parent = pk ? byKey.get(pk) : undefined;
      if (!parent || parent === cur) break;
      cur = parent;
    }
    return cur.key;
  };
  const at = (e: PlaneEntry) => (e.kind === 'record' ? e.record.createdAt : e.kind === 'running' ? Number.MAX_SAFE_INTEGER : e.failed.at);
  const groups = new Map<string, PlaneEntry[]>();
  for (const e of entries) {
    const root = rootOf(e);
    const g = groups.get(root);
    if (g) g.push(e);
    else groups.set(root, [e]);
  }
  const order = [...groups.keys()].sort((x, y) => {
    const ix = entries.findIndex((e) => e.key === x);
    const iy = entries.findIndex((e) => e.key === y);
    return ix - iy;
  });

  const rows = order.map((root) => {
    const members = groups.get(root)!.sort((x, y) => (x.key === root ? -1 : y.key === root ? 1 : at(x) - at(y)));
    const pics: Array<{ entry: PlaneEntry; index: number; src: string | null; w: number; h: number }> = [];
    for (const entry of members) {
      if (entry.kind === 'record') {
        const est = outputSize(entry.record.settings);
        entry.images.forEach((src, index) => pics.push({ entry, index, src, ...(dims.get(src) ?? est) }));
      } else if (entry.kind === 'running') {
        const est = outputSize(entry.settings);
        const n = Math.max(1, entry.settings.batch_size || 1);
        for (let index = 0; index < n; index++) pics.push({ entry, index, src: index === 0 ? entry.previewUrl : null, ...est });
      } else {
        pics.push({ entry, index: 0, src: null, ...outputSize(entry.failed.settings) });
      }
    }
    const sizes = pics.map((p) => ({ w: p.w * S, h: p.h * S }));
    const rowH = Math.max(...sizes.map((s) => s.h));
    const reach = Math.max(...sizes.map(reachY));
    return { pics, sizes, rowH, reach };
  });

  const tiles: Tile[] = [];
  let y = 0;
  rows.forEach((row, ri) => {
    const gaps = row.sizes.slice(1).map((s, i) => Math.max(spareX(row.sizes[i]), spareX(s)) + BUF);
    const rowW = row.sizes.reduce((a, s) => a + s.w, 0) + gaps.reduce((a, g) => a + g, 0);
    let x = -rowW / 2;
    row.pics.forEach((p, i) => {
      const s = row.sizes[i];
      tiles.push({ id: tileId(p.entry.key, p.index), entry: p.entry, index: p.index, src: p.src, left: x, top: y + (row.rowH - s.h) / 2, w: s.w, h: s.h });
      x += s.w + (gaps[i] ?? 0);
    });
    const next = rows[ri + 1];
    if (next) {
      const gapY = Math.max(row.reach - row.rowH / 2, next.reach - next.rowH / 2) + BUF;
      y += row.rowH + Math.max(72, gapY);
    }
  });
  return tiles;
}

/** Nearest familiar ratio label (832×1216 → 2:3). */
export function ratioLabel(w: number, h: number): string {
  const known: Array<[number, number]> = [[1, 1], [4, 5], [3, 4], [2, 3], [9, 16], [5, 4], [4, 3], [3, 2], [16, 9], [21, 9], [9, 21]];
  let best = known[0];
  for (const k of known) if (Math.abs(k[0] / k[1] - w / h) < Math.abs(best[0] / best[1] - w / h)) best = k;
  return `${best[0]}:${best[1]}`;
}

/** What a derived image was made by, for the compare labels. */
export function derivedKind(s: GenerationSettings): string {
  if (s.generationMode === 'upscale') return s.upscale?.scale ? `Upscale ${s.upscale.scale}×` : 'Upscale';
  if (s.generationMode === 'outpaint') return 'Extend';
  if (s.generationMode === 'edit') return 'Edit';
  if (s.generationMode === 'img2img') return 'Variation';
  return 'After';
}
