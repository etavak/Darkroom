import { getHistory, queuePrompt, viewImage } from './comfyClient.js';
import { resolvePreprocessor } from '../workflow/modules/controlnet.js';
import type { ControlNetSettings } from '../workflow/index.js';

/** Recent maps by input image + type, so toggling "Show map" doesn't run ComfyUI again. */
const cache = new Map<string, Buffer>();
const CACHE_MAX = 24;
const WAIT_MS = 180_000;

/**
 * Runs just the preprocessor (load image → pose / depth / edges → preview) in ComfyUI and
 * returns the map as PNG bytes. Waits behind whatever ComfyUI is already doing.
 */
export async function renderControlNetMap(image: string, kind: ControlNetSettings['preprocessor']): Promise<Buffer> {
  const key = `${kind}|${image}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pre = await resolvePreprocessor(kind);
  if (!pre) throw new Error('This guide type uses the image as it is — there is no map to show.');

  const prompt = {
    '1': { class_type: 'LoadImage', inputs: { image } },
    '2': { class_type: pre.className, inputs: { ...pre.inputs, image: ['1', 0] } },
    '3': { class_type: 'PreviewImage', inputs: { images: ['2', 0] } },
  };
  // Its own client id: generation progress listens to Darkroom's id only
  const { prompt_id } = await queuePrompt(prompt, 'darkroom-controlnet-map');

  const started = Date.now();
  while (Date.now() - started < WAIT_MS) {
    await new Promise((r) => setTimeout(r, 400));
    const entry = await getHistory(prompt_id);
    if (!entry) continue;
    const status = entry.status as { status_str?: string; messages?: Array<[string, Record<string, unknown>]> } | undefined;
    if (status?.status_str === 'error') {
      const err = status.messages?.find((m) => m[0] === 'execution_error')?.[1];
      throw new Error(typeof err?.exception_message === 'string' ? `ComfyUI: ${err.exception_message.trim()}` : 'ComfyUI could not make the map');
    }
    const outputs = entry.outputs as Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> | undefined;
    const img = outputs?.['3']?.images?.[0];
    if (img) {
      const buf = await viewImage({ filename: img.filename, subfolder: img.subfolder, type: img.type ?? 'temp' });
      cache.set(key, buf);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
      return buf;
    }
    if (status?.status_str === 'success') throw new Error('ComfyUI finished without a map');
  }
  throw new Error('ComfyUI took too long to make the map');
}
