import type { ControlNetPreprocessor, ControlNetSettings, DetailerSettings } from '@/types/generation';

/** ControlNet card state (the guide image is uploaded to ComfyUI's input folder). */
export type ControlNetUiState = {
  enabled: boolean;
  name: string;
  image: string;
  previewUrl: string | null;
  strength: number;
  start_percent: number;
  end_percent: number;
  preprocessor: ControlNetPreprocessor;
};

/** Guides applied per image (the server takes the same number). */
export const MAX_CONTROLNETS = 3;

export const DEFAULT_CONTROLNET_UI: ControlNetUiState = {
  enabled: false,
  name: '',
  image: '',
  previewUrl: null,
  strength: 1,
  start_percent: 0,
  end_percent: 1,
  preprocessor: 'none',
};

/** What the server gets, or null when the guide isn't complete. */
export function controlNetPayload(ui: ControlNetUiState): ControlNetSettings | null {
  if (!ui.enabled || !ui.name || !ui.image) return null;
  return {
    name: ui.name,
    image: ui.image,
    strength: ui.strength,
    start_percent: ui.start_percent,
    end_percent: ui.end_percent,
    preprocessor: ui.preprocessor === 'none' ? undefined : ui.preprocessor,
  };
}

/** Request fields for the guides: every complete one, plus the first under the older name. */
export function controlNetFields(list: ControlNetUiState[]): { controlnets?: ControlNetSettings[]; controlnet?: ControlNetSettings } {
  const out = list.map(controlNetPayload).filter((c): c is ControlNetSettings => c !== null).slice(0, MAX_CONTROLNETS);
  return out.length ? { controlnets: out, controlnet: out[0] } : {};
}

const PREPROCESSORS: ControlNetPreprocessor[] = ['none', 'canny', 'depth', 'openpose', 'lineart', 'tile'];

/** Card state for a saved guide (from a record, a session or a dropped PNG). */
export function controlNetFromSettings(cn: Partial<ControlNetSettings> | null | undefined): ControlNetUiState | null {
  if (!cn || typeof cn.name !== 'string' || typeof cn.image !== 'string' || !cn.image) return null;
  return {
    enabled: true,
    name: cn.name,
    image: cn.image,
    previewUrl: null,
    strength: typeof cn.strength === 'number' ? cn.strength : 1,
    start_percent: typeof cn.start_percent === 'number' ? cn.start_percent : 0,
    end_percent: typeof cn.end_percent === 'number' ? cn.end_percent : 1,
    preprocessor: cn.preprocessor && PREPROCESSORS.includes(cn.preprocessor) ? cn.preprocessor : 'none',
  };
}

/** Every guide in saved settings (new `controlnets`, or the older single `controlnet`). */
export function controlNetsFromSettings(s: { controlnets?: unknown; controlnet?: unknown } | null | undefined): ControlNetUiState[] {
  if (!s) return [];
  const raw = Array.isArray(s.controlnets) && s.controlnets.length ? s.controlnets : s.controlnet ? [s.controlnet] : [];
  return raw
    .map((c) => controlNetFromSettings(c as Partial<ControlNetSettings>))
    .filter((c): c is ControlNetUiState => c !== null)
    .slice(0, MAX_CONTROLNETS);
}

export const DEFAULT_DETAILER: DetailerSettings = {
  enabled: false,
  guide_size: 512,
  steps: 12,
  denoise: 0.4,
  detector: 'bbox/face_yolov8m.pt',
};
