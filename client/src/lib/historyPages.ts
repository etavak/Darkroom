import type { GenerationRecord } from '@/types/generation';

/** Where the next (older) page starts: the oldest generation loaded so far. */
export type HistoryCursor = { at: number; id: string };

/** (createdAt, id) order, newest first — the server pages the same way. */
export const isOlder = (a: GenerationRecord, cur: HistoryCursor) => a.createdAt < cur.at || (a.createdAt === cur.at && a.id < cur.id);

export const cursorOf = (list: GenerationRecord[]): HistoryCursor | undefined => {
  const last = list[list.length - 1];
  return last ? { at: last.createdAt, id: last.id } : undefined;
};

type Page = { items: GenerationRecord[]; hasMore: boolean };

/**
 * A fresh newest page replaces the newest part of what's loaded; older pages already
 * loaded stay (unless `reset`). `hidden` = ids waiting out their undo window.
 */
export function mergeNewestPage(prev: GenerationRecord[], page: Page, opts: { reset?: boolean; hidden?: Set<string> } = {}): Page {
  const cur = cursorOf(page.items);
  const older = !opts.reset && cur && page.hasMore ? prev.filter((i) => isOlder(i, cur)) : [];
  const hidden = opts.hidden ?? new Set<string>();
  return { items: [...page.items, ...older].filter((i) => !hidden.has(i.id)), hasMore: older.length ? true : page.hasMore };
}

/** An older page goes on the end (skipping anything already there or hidden). */
export function appendOlderPage(prev: GenerationRecord[], page: Page, hidden: Set<string> = new Set()): Page {
  const have = new Set(prev.map((i) => i.id));
  return { items: [...prev, ...page.items.filter((i) => !have.has(i.id) && !hidden.has(i.id))], hasMore: page.hasMore };
}
