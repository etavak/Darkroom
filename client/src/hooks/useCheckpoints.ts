import { useCallback, useEffect, useState } from 'react';
import { fetchCheckpoints } from '../lib/api';

export function useCheckpoints() {
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCheckpoints();
      setCheckpoints(data.checkpoints);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load checkpoints');
      setCheckpoints([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { checkpoints, loading, error, reload };
}
