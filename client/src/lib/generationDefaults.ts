import type { ControlNetSettings, DetailerSettings } from '@/types/generation';

/** ControlNet card state (the guide image is uploaded to ComfyUI's input folder). */
export type ControlNetUiState = {
  enabled: boolean;
  name: string;
  image: string;
  previewUrl: string | null;
  strength: number;
  start_percent: number;
  end_percent: number;
  preprocessor: 'none' | 'canny' | 'depth' | 'openpose';
};

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

export const DEFAULT_DETAILER: DetailerSettings = {
  enabled: false,
  guide_size: 512,
  steps: 12,
  denoise: 0.4,
  detector: 'bbox/face_yolov8m.pt',
};
