import { useCallback, useEffect, useState } from 'react';
import {
  applyUiAppearance,
  loadUiSettings,
  saveUiSettings,
  type PreviewQuality,
  type UiSettings,
} from '@/lib/uiSettings';

export function useUiSettings() {
  const [settings, setSettings] = useState<UiSettings>(() => {
    const loaded = loadUiSettings();
    applyUiAppearance(loaded);
    return loaded;
  });

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('darkroom.') || e.key === null) {
        const next = loadUiSettings();
        applyUiAppearance(next);
        setSettings(next);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((partial: Partial<UiSettings>) => {
    setSettings(saveUiSettings(partial));
  }, []);

  const setLivePreview = useCallback((livePreview: boolean) => {
    setSettings(saveUiSettings({ livePreview }));
  }, []);

  const setPreviewQuality = useCallback((previewQuality: PreviewQuality) => {
    setSettings(saveUiSettings({ previewQuality }));
  }, []);

  return {
    settings,
    update,
    setLivePreview,
    setPreviewQuality,
  };
}
