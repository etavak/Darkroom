export type PanelSectionId =
  | 'model'
  | 'source'
  | 'prompt'
  | 'image'
  | 'loras'
  | 'sampling';

export const PANEL_SECTION_IDS: PanelSectionId[] = [
  'model',
  'source',
  'prompt',
  'image',
  'loras',
  'sampling',
];

export type PanelSectionState = Record<PanelSectionId, boolean>;

const STORAGE_KEY = 'darkroom.panelSections';

/** true = expanded */
export const DEFAULT_PANEL_SECTIONS: PanelSectionState = {
  model: true,
  source: false,
  prompt: true,
  image: true,
  loras: true,
  sampling: true,
};

export function loadPanelSections(): PanelSectionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PANEL_SECTIONS };
    const parsed = JSON.parse(raw) as Partial<PanelSectionState>;
    return {
      model: parsed.model ?? true,
      source: parsed.source ?? false,
      prompt: parsed.prompt ?? true,
      image: parsed.image ?? true,
      loras: parsed.loras ?? true,
      sampling: parsed.sampling ?? true,
    };
  } catch {
    return { ...DEFAULT_PANEL_SECTIONS };
  }
}

export function savePanelSections(state: PanelSectionState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}
