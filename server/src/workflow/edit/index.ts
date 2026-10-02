import type { PipelineContext } from '../graph.js';
import { applyKontextEdit } from './kontext.js';
import { applyQwenEdit } from './qwen.js';

export type EditStrategy = 'kontext' | 'qwen';

export async function applyEditModule(
  ctx: PipelineContext,
  strategy: EditStrategy,
): Promise<void> {
  if (strategy === 'qwen') {
    await applyQwenEdit(ctx);
    return;
  }
  await applyKontextEdit(ctx);
}
