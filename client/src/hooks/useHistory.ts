import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteHistoryItem, fetchHistory } from '../lib/api';
import type { GenerationRecord } from '../types/generation';

export function useHistory() {
  const [items, setItems] = useState<GenerationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Soft-deleted generations still inside their undo window (one Undo restores them all) */
  const [pendingDelete, setPendingDelete] = useState<GenerationRecord[] | null>(null);
  const pendingRef = useRef<GenerationRecord[]>([]);
  const pendingTimer = useRef<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory();
      // Items waiting out their undo window stay hidden
      const hidden = new Set(pendingRef.current.map((i) => i.id));
      setItems(data.items.filter((i) => !hidden.has(i.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
