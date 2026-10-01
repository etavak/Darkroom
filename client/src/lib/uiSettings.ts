export type PreviewQuality = 'fast' | 'detailed';
export type HistoryPosition = 'right' | 'bottom' | 'hidden';
export type UiScale = 0.85 | 1 | 1.1 | 1.25;
/** Preview stage backdrop behind the image. */
export type CanvasBackground = 'theme' | 'neutral' | 'black';

export type ShortcutAction =
  | 'generate'
  | 'cancel'
  | 'prevHistory'
  | 'nextHistory'
  | 'favorite'
  | 'openSettings';

export type ShortcutMap = Record<ShortcutAction, string>;

export type UiSettings = {
  livePreview: boolean;
  previewQuality: PreviewQuality;
  /** CSS zoom / root font scale */
  uiScale: UiScale;
  reduceMotion: boolean;
  /** 0–100 multiplier for grain + glow overlays */
  atmosphereIntensity: number;
  /** Preview canvas fill behind the image */
  canvasBackground: CanvasBackground;
  historyPosition: HistoryPosition;
  resizablePanels: boolean;
  jumpToNewest: boolean;
  confirmDelete: boolean;
  shortcuts: ShortcutMap;
};

const KEYS = {
  livePreview: 'darkroom.livePreview',
  previewQuality: 'darkroom.previewQuality',
  uiScale: 'darkroom.uiScale',
  reduceMotion: 'darkroom.reduceMotion',
  atmosphereIntensity: 'darkroom.atmosphereIntensity',
  canvasBackground: 'darkroom.canvasBackground',
  historyPosition: 'darkroom.historyPosition',
  resizablePanels: 'darkroom.resizablePanels',
  jumpToNewest: 'darkroom.jumpToNewest',
  confirmDelete: 'darkroom.confirmDelete',
  shortcuts: 'darkroom.shortcuts',
} as const;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  generate: 'Ctrl+Enter',
  cancel: 'Escape',
  prevHistory: 'ArrowLeft',
  nextHistory: 'ArrowRight',
  favorite: 'f',
  openSettings: 'Ctrl+,',
};

export const DEFAULT_UI_SETTINGS: UiSettings = {
  livePreview: true,
  previewQuality: 'detailed',
  uiScale: 1,
  reduceMotion: false,
  atmosphereIntensity: 100,
  canvasBackground: 'theme',
  historyPosition: 'right',
  resizablePanels: false,
  jumpToNewest: true,
  confirmDelete: true,
  shortcuts: { ...DEFAULT_SHORTCUTS },
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

function readNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
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

function readUiScale(fallback: UiScale): UiScale {
  try {
    const raw = Number(localStorage.getItem(KEYS.uiScale));
    if (raw === 0.85 || raw === 1 || raw === 1.1 || raw === 1.25) return raw;
    return fallback;
  } catch {
    return fallback;
  }
}

function readHistoryPosition(fallback: HistoryPosition): HistoryPosition {
  try {
    const raw = localStorage.getItem(KEYS.historyPosition);
    if (raw === 'right' || raw === 'bottom' || raw === 'hidden') return raw;
    return fallback;
  } catch {
    return fallback;
  }
}

function readCanvasBackground(fallback: CanvasBackground): CanvasBackground {
  try {
    const raw = localStorage.getItem(KEYS.canvasBackground);
    if (raw === 'theme' || raw === 'neutral' || raw === 'black') return raw;
    return fallback;
  } catch {
    return fallback;
  }
}

function readShortcuts(fallback: ShortcutMap): ShortcutMap {
  try {
    const raw = localStorage.getItem(KEYS.shortcuts);
    if (!raw) return { ...fallback };
    const parsed = JSON.parse(raw) as Partial<ShortcutMap>;
    return { ...fallback, ...parsed };
  } catch {
    return { ...fallback };
  }
}

/** Apply layout CSS vars from settings. */
export function applyUiAppearance(settings: UiSettings) {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(settings.uiScale));
  root.style.setProperty('--atmosphere-intensity', String(settings.atmosphereIntensity / 100));
  root.dataset.reduceMotion = settings.reduceMotion ? 'true' : 'false';
  root.dataset.historyPosition = settings.historyPosition;
  root.dataset.resizablePanels = settings.resizablePanels ? 'true' : 'false';
  root.dataset.canvasBackground = settings.canvasBackground;
}

export function loadUiSettings(): UiSettings {
  return {
    livePreview: readBool(KEYS.livePreview, DEFAULT_UI_SETTINGS.livePreview),
    previewQuality: readQuality(DEFAULT_UI_SETTINGS.previewQuality),
    uiScale: readUiScale(DEFAULT_UI_SETTINGS.uiScale),
    reduceMotion: readBool(KEYS.reduceMotion, DEFAULT_UI_SETTINGS.reduceMotion),
    atmosphereIntensity: readNumber(
      KEYS.atmosphereIntensity,
      DEFAULT_UI_SETTINGS.atmosphereIntensity,
      0,
      100,
    ),
    canvasBackground: readCanvasBackground(DEFAULT_UI_SETTINGS.canvasBackground),
    historyPosition: readHistoryPosition(DEFAULT_UI_SETTINGS.historyPosition),
    resizablePanels: readBool(KEYS.resizablePanels, DEFAULT_UI_SETTINGS.resizablePanels),
    jumpToNewest: readBool(KEYS.jumpToNewest, DEFAULT_UI_SETTINGS.jumpToNewest),
    confirmDelete: readBool(KEYS.confirmDelete, DEFAULT_UI_SETTINGS.confirmDelete),
    shortcuts: readShortcuts(DEFAULT_SHORTCUTS),
  };
}

export function saveUiSettings(partial: Partial<UiSettings>): UiSettings {
  const current = loadUiSettings();
  const next: UiSettings = {
    ...current,
    ...partial,
    shortcuts: partial.shortcuts
      ? { ...current.shortcuts, ...partial.shortcuts }
      : current.shortcuts,
  };
  try {
    localStorage.setItem(KEYS.livePreview, String(next.livePreview));
    localStorage.setItem(KEYS.previewQuality, next.previewQuality);
    localStorage.setItem(KEYS.uiScale, String(next.uiScale));
    localStorage.setItem(KEYS.reduceMotion, String(next.reduceMotion));
    localStorage.setItem(KEYS.atmosphereIntensity, String(next.atmosphereIntensity));
    localStorage.setItem(KEYS.canvasBackground, next.canvasBackground);
    localStorage.setItem(KEYS.historyPosition, next.historyPosition);
    localStorage.setItem(KEYS.resizablePanels, String(next.resizablePanels));
    localStorage.setItem(KEYS.jumpToNewest, String(next.jumpToNewest));
    localStorage.setItem(KEYS.confirmDelete, String(next.confirmDelete));
    localStorage.setItem(KEYS.shortcuts, JSON.stringify(next.shortcuts));
  } catch {
    // private mode / quota
  }
  applyUiAppearance(next);
  return next;
}

/** Match a KeyboardEvent against a shortcut string like "Ctrl+Enter" or "f". */
export function eventMatchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+').map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  const wantCtrl = parts.includes('ctrl') || parts.includes('cmd') || parts.includes('meta');
  const wantAlt = parts.includes('alt');
  const wantShift = parts.includes('shift');

  const ctrl = e.ctrlKey || e.metaKey;
  if (wantCtrl !== ctrl) return false;
  if (wantAlt !== e.altKey) return false;
  if (wantShift !== e.shiftKey && key !== 'shift') return false;

  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 'enter') return eventKey === 'Enter' || eventKey === 'enter';
  if (key === 'escape' || key === 'esc') return eventKey === 'Escape';
  if (key === 'arrowleft') return eventKey === 'ArrowLeft';
  if (key === 'arrowright') return eventKey === 'ArrowRight';
  if (key === ',') return eventKey === ',' || e.code === 'Comma';
  return eventKey === key || e.key.toLowerCase() === key;
}
