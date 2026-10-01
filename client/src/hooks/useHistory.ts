import { useCallback, useEffect, useState } from 'react';
import { deleteHistoryItem, fetchHistory } from '../lib/api';
import type { GenerationRecord } from '../types/generation';

export function useHistory() {
  const [items, setItems] = useState<GenerationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const remove = useCallback(async (id: string) => {
    await deleteHistoryItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const confirmRemove = useCallback(
    async (id: string, confirmDelete: boolean) => {
      if (confirmDelete && !window.confirm('Remove this generation from history?')) {
        return false;
      }
      await remove(id);
      return true;
    },
    [remove],
  );

  return { items, loading, error, reload, remove, confirmRemove };
}