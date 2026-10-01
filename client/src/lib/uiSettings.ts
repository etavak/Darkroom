export type PreviewQuality = 'fast' | 'detailed';

export type UiSettings = {
  livePreview: boolean;
  previewQuality: PreviewQuality;
};

const KEYS = {
  livePreview: 'darkroom.livePreview',
  previewQuality: 'darkroom.previewQuality',
} as const;

export const DEFAULT_UI_SETTINGS: UiSettings = {
  livePreview: true,
  previewQuality: 'detailed',
};

/** Maps UI quality to ComfyUI preview_method values. */
export function qualityToPreviewMethod(quality: PreviewQuality): 'latent2rgb' | 'taesd' {
  return quality === 'fast' ? 'latent2rgb' : 'taesd';
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

function readQuality(fallback: PreviewQuality): PreviewQuality {
  try {
    const raw = localStorage.getItem(KEYS.previewQuality);
    if (raw === 'fast' || raw === 'detailed') return raw;
    return fallback;
  } catch {
    return fallback;
  }
}

export function loadUiSettings(): UiSettings {
  return {
    livePreview: readBool(KEYS.livePreview, DEFAULT_UI_SETTINGS.livePreview),
    previewQuality: readQuality(DEFAULT_UI_SETTINGS.previewQuality),
  };
}

export function saveUiSettings(partial: Partial<UiSettings>): UiSettings {
  const next = { ...loadUiSettings(), ...partial };
  try {
    localStorage.setItem(KEYS.livePreview, String(next.livePreview));
    localStorage.setItem(KEYS.previewQuality, next.previewQuality);
  } catch {
    // private mode / quota — keep in-memory only
  }
  return next;
}
