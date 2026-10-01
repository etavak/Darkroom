import { useCallback, useEffect, useState } from 'react';
import {
  loadUiSettings,
  saveUiSettings,
  type PreviewQuality,
  type UiSettings,
} from '@/lib/uiSettings';

export function useUiSettings() {
  const [settings, setSettings] = useState<UiSettings>(() => loadUiSettings());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === 'darkroom.livePreview' ||
        e.key === 'darkroom.previewQuality' ||
        e.key === null
      ) {
        setSettings(loadUiSettings());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setLivePreview = useCallback((livePreview: boolean) => {
    setSettings(saveUiSettings({ livePreview }));
  }, []);

  const setPreviewQuality = useCallback((previewQuality: PreviewQuality) => {
    setSettings(saveUiSettings({ previewQuality }));
  }, []);

  return { settings, setLivePreview, setPreviewQuality };
}
