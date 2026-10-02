import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteHistoryItem, fetchHistory } from '../lib/api';
import type { GenerationRecord } from '../types/generation';

export function useHistory() {
  const [items, setItems] = useState<GenerationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GenerationRecord | null>(null);
  const pendingTimer = useRef<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory();
      setItems(data.items);
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

  const commitDelete = useCallback(async (id: string) => {
    await deleteHistoryItem(id);
  }, []);

  /** Soft-delete with 5s undo window. */
  const softDelete = useCallback(
    (item: GenerationRecord) => {
      if (pendingTimer.current) {
        window.clearTimeout(pendingTimer.current);
        pendingTimer.current = null;
        if (pendingDelete) {
          void commitDelete(pendingDelete.id);
        }
      }
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setPendingDelete(item);
      pendingTimer.current = window.setTimeout(() => {
        void commitDelete(item.id);
        setPendingDelete(null);
        pendingTimer.current = null;
      }, 5000);
    },
    [commitDelete, pendingDelete],
  );

  const undoDelete = useCallback((): GenerationRecord | null => {
    if (!pendingDelete) return null;
    if (pendingTimer.current) {
      window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    const restored = pendingDelete;
    setPendingDelete(null);
    setItems((prev) =>
      [...prev, restored].sort((a, b) => b.createdAt - a.createdAt),
    );
    return restored;
  }, [pendingDelete]);

  const dismissUndo = useCallback(() => {
    if (!pendingDelete) return;
    if (pendingTimer.current) {
      window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    void commitDelete(pendingDelete.id);
    setPendingDelete(null);
  }, [commitDelete, pendingDelete]);

  const remove = useCallback(
    async (id: string) => {
      const item = items.find((i) => i.id === id);
      if (item) softDelete(item);
      else await commitDelete(id);
    },
    [commitDelete, items, softDelete],
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
