import { useCallback, useEffect, useState } from 'react';
import { fetchFamilies } from '../lib/api';
import type { FamilySummary } from '../types/presets';

export function useFamilies() {
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFamilies();
      setFamilies(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load families');
      setFamilies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { families, loading, error, reload };
}
