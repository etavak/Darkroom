import type { PipelineContext } from '../graph.js';
import { applyKontextEdit, canRunKontextEdit } from './kontext.js';
import { applyQwenEdit, canRunQwenEdit } from './qwen.js';

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

export async function editStrategyAvailable(strategy: EditStrategy): Promise<boolean> {
  if (strategy === 'qwen') return canRunQwenEdit();
  return canRunKontextEdit();
}
