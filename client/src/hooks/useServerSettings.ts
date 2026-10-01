import { useCallback, useEffect, useState } from 'react';
import {
  fetchDiagnostics,
  fetchServerSettings,
  runBackupApi,
  updateServerSettings,
} from '@/lib/api';
import {
  DEFAULT_SERVER_SETTINGS,
  type DiskUsageInfo,
  type ServerSettings,
  type ServerSettingsResponse,
} from '@/types/serverSettings';

export function useServerSettings() {
  const [settings, setSettings] = useState<ServerSettings>(DEFAULT_SERVER_SETTINGS);
  const [diskUsage, setDiskUsage] = useState<DiskUsageInfo | null>(null);
  const [hints, setHints] = useState<ServerSettingsResponse['hints']>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyResponse = useCallback((res: ServerSettingsResponse) => {
    setSettings(res.settings);
    setDiskUsage(res.diskUsage);
    setHints(res.hints ?? {});
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchServerSettings();
      applyResponse(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load server settings');
    } finally {
      setLoading(false);
    }
  }, [applyResponse]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patch = useCallback(
    async (partial: Partial<ServerSettings>) => {
      // Optimistic local update
      setSettings((prev) => ({ ...prev, ...partial }));
      try {
        const res = await updateServerSettings(partial);
        applyResponse(res);
        return res;
      } catch (err) {
        await reload();
        throw err;
      }
    },
    [applyResponse, reload],
  );

  const copyDiagnostics = useCallback(async () => {
    const { text } = await fetchDiagnostics();
    await navigator.clipboard.writeText(text);
    return text;
  }, []);

  const backupNow = useCallback(async () => {
    const res = await runBackupApi();
    if (res.diskUsage) setDiskUsage(res.diskUsage);
    return res;
  }, []);

  return {
    settings,
    diskUsage,
    hints,
    loading,
    error,
    reload,
    patch,
    copyDiagnostics,
    backupNow,
  };
}
