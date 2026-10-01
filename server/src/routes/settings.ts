import { Router } from 'express';
import {
  qualityToPreviewMethod,
  readEnvValue,
  supportsPerPromptPreviewMethod,
  upsertEnvValue,
} from '../services/envSettings.js';

export const settingsRouter = Router();

settingsRouter.get('/preview', (_req, res) => {
  res.json({
    supportsPerPromptPreview: supportsPerPromptPreviewMethod(),
    launchPreviewMethod: readEnvValue('COMFY_PREVIEW_METHOD') || 'auto',
  });
});

settingsRouter.put('/preview', (req, res) => {
  const quality = req.body?.quality;
  if (quality !== 'fast' && quality !== 'detailed') {
    res.status(400).json({ error: 'quality must be "fast" or "detailed"' });
    return;
  }

  const supports = supportsPerPromptPreviewMethod();
  const method = qualityToPreviewMethod(quality);

  // When ComfyUI cannot override per prompt, persist for the next launcher start.
  if (!supports) {
    upsertEnvValue('COMFY_PREVIEW_METHOD', method);
  }

  res.json({
    supportsPerPromptPreview: supports,
    launchPreviewMethod: supports
      ? 'auto'
      : readEnvValue('COMFY_PREVIEW_METHOD') || method,
    previewMethod: method,
  });
});
