import type { WorkflowModule } from '../types.js';

/**
 * Chains LoraLoader nodes onto model + clip.
 * Built-in ComfyUI node — no custom packs required.
 */
export const lorasModule: WorkflowModule = {
  name: 'loras',

  shouldApply(settings) {
    return Array.isArray(settings.loras) && settings.loras.length > 0;
  },

  apply(ctx) {
    const loras = ctx.settings.loras ?? [];
    for (const lora of loras) {
      if (!lora.name) continue;
      const id = ctx.graph.add('LoraLoader', {
        lora_name: lora.name,
        strength_model: lora.strength_model,
        strength_clip: lora.strength_clip,
        model: ctx.model,
        clip: ctx.clip,
      });
      ctx.model = [id, 0];
      ctx.clip = [id, 1];
    }
    // Runs before baseModule.encodePrompts, so prompts encode with the LoRA-patched clip.
  },
};
