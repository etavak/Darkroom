import { useCallback, useEffect, useState } from 'react';
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
  },
};

export function useModels() {
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCatalog(await fetchModels());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models');
      setCatalog(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { catalog, loading, error, reload };
}
