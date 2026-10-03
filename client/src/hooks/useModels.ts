import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchModels } from '../lib/api';
import type { ModelCatalog } from '../types/generation';

const EMPTY: ModelCatalog = {
  checkpoints: [],
  diffusion_models: [],
  text_encoders: [],
  vae: [],
  loras: [],
  controlnet: [],
  upscale_models: [],
  embeddings: [],
  clip_types: [],
  dual_clip_types: [],
  detailer_detectors: [],
  samplers: [],
  schedulers: [],
  available: {
    checkpoint: false,
    unet: false,
    clip: false,
    dualClip: false,
    vae: false,
    lora: false,
    controlnet: false,
    upscale: false,
    ggufUnet: false,
    ggufClip: false,
    ggufDualClip: false,
    faceDetailer: false,
    controlnetAux: false,
  },
};

export function useModels() {
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const lastJson = useRef('');
  /**
   * Re-read the model list. `quiet` (background refresh) skips the loading state, and an
   * unchanged list doesn't re-render anything.
   */
  const reload = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const next = await fetchModels();
      const json = JSON.stringify(next);
      if (json !== lastJson.current) {
        lastJson.current = json;
        setCatalog(next);
      }
    } catch (err) {
      if (!quiet) {
        setError(err instanceof Error ? err.message : 'Failed to load models');
        lastJson.current = '';
        setCatalog(EMPTY);
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { catalog, loading, error, reload };
}
