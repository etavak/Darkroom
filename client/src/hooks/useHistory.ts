import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteHistoryItem, fetchHistory } from '../lib/api';
import type { GenerationRecord } from '../types/generation';

/** (createdAt, id) order, newest first — the server pages the same way */
const isOlder = (a: GenerationRecord, cur: { at: number; id: string }) => a.createdAt < cur.at || (a.createdAt === cur.at && a.id < cur.id);
const cursorOf = (list: GenerationRecord[]) => {
  const last = list[list.length - 1];
  return last ? { at: last.createdAt, id: last.id } : undefined;
};

export function useHistory() {
  const [items, setItems] = useState<GenerationRecord[]>([]);
  /** Older generations are still on the server */
  const [hasMore, setHasMore] = useState(false);
  /** All completed generations on the server */
  const [total, setTotal] = useState(0);
  const loadingMore = useRef(false);
  const itemsRef = useRef<GenerationRecord[]>([]);
  itemsRef.current = items;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Soft-deleted generations still inside their undo window (one Undo restores them all) */
  const [pendingDelete, setPendingDelete] = useState<GenerationRecord[] | null>(null);
  const pendingRef = useRef<GenerationRecord[]>([]);
  const pendingTimer = useRef<number | null>(null);

  /**
   * Refresh the newest page. Older pages already loaded stay (unless `reset`), so a new
   * image doesn't throw away what you scrolled to.
   */
  const reload = useCallback(async (opts?: { reset?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchHistory();
      // Items waiting out their undo window stay hidden
      const hidden = new Set(pendingRef.current.map((i) => i.id));
      const cur = cursorOf(page.items);
      const older = !opts?.reset && cur && page.hasMore ? itemsRef.current.filter((i) => isOlder(i, cur)) : [];
      setItems([...page.items, ...older].filter((i) => !hidden.has(i.id)));
      setHasMore(older.length ? true : page.hasMore);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** The next page of older generations (no-op while one is loading or none are left). */
  const loadMore = useCallback(async () => {
    if (loadingMore.current) return false;
    const cur = cursorOf(itemsRef.current);
    if (!cur) return false;
    loadingMore.current = true;
    try {
      const page = await fetchHistory(cur);
      const hidden = new Set(pendingRef.current.map((i) => i.id));
      const have = new Set(itemsRef.current.map((i) => i.id));
      const next = [...itemsRef.current, ...page.items.filter((i) => !have.has(i.id) && !hidden.has(i.id))];
      itemsRef.current = next;
      setItems(next);
      setHasMore(page.hasMore);
      setTotal(page.total);
      return page.hasMore;
    } catch {
      return false;
    } finally {
      loadingMore.current = false;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
    };
  }, []);

  const commitPending = useCallback(() => {
    if (pendingTimer.current) {
      window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    const list = pendingRef.current;
    pendingRef.current = [];
    setPendingDelete(null);
    for (const it of list) void deleteHistoryItem(it.id);
  }, []);

  /** Soft-delete one or several generations with a 5 s undo window. */
  const softDelete = useCallback(
    (target: GenerationRecord | GenerationRecord[]) => {
      const list = Array.isArray(target) ? target : [target];
      if (!list.length) return;
      // A new delete commits the previous one
      commitPending();
      const ids = new Set(list.map((i) => i.id));
      pendingRef.current = list;
      setItems((prev) => prev.filter((i) => !ids.has(i.id)));
      setPendingDelete(list);
      pendingTimer.current = window.setTimeout(commitPending, 5000);
    },
    [commitPending],
  );

  /** Puts the pending generations back; returns them (newest first). */
  const undoDelete = useCallback((): GenerationRecord[] => {
    if (pendingTimer.current) {
      window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    const restored = pendingRef.current;
    pendingRef.current = [];
    setPendingDelete(null);
    if (restored.length) setItems((prev) => [...prev, ...restored].sort((a, b) => b.createdAt - a.createdAt));
    return [...restored].sort((a, b) => b.createdAt - a.createdAt);
  }, []);

  const dismissUndo = useCallback(() => {
    if (pendingRef.current.length) commitPending();
  }, [commitPending]);

  const remove = useCallback(
    async (id: string) => {
      const item = items.find((i) => i.id === id);
      if (item) softDelete(item);
      else await deleteHistoryItem(id);
    },
    [items, softDelete],
  );

  return {
    items,
    hasMore,
    total,
    loadMore,
    loading,
    error,
    reload,
    remove,
    softDelete,
    undoDelete,
    dismissUndo,
    pendingDelete,
  };
}
