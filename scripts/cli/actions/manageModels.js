import path from 'node:path';
import * as p from '@clack/prompts';
import {
  deleteModel,
  formatBytes,
  listFamilies,
  listModels,
  renameModel,
  saveCheckpointFamily,
} from '../lib/models.js';
import { handleCancel } from '../lib/prompt.js';
import { MODEL_TYPE_OPTIONS } from '../lib/safetensors.js';

export async function manageModels() {
  const typeFilter = await p.select({
    message: 'Which models?',
    options: [
      { value: '', label: 'All types' },
      ...MODEL_TYPE_OPTIONS,
    ],
  });
  if (handleCancel(typeFilter)) return;

  const models = listModels(typeFilter || undefined);
  if (models.length === 0) {
    p.log.warn('No models found. Is COMFY_DIR set?');
    return;
  }

  const picked = await p.select({
    message: `Select a model (${models.length})`,
    options: models.map((m) => ({
      value: m.path,
      label: m.name,
      hint: `${m.type} · ${formatBytes(m.size)}${m.family ? ` · ${m.family}` : ''}`,
    })),
  });
  if (handleCancel(picked)) return;

  const model = models.find((m) => m.path === picked);
  if (!model) return;

  const action = await p.select({
    message: model.name,
    options: [
      { value: 'rename', label: 'Rename' },
      { value: 'family', label: 'Change family', hint: model.type === 'checkpoint' ? undefined : 'checkpoints only' },
      { value: 'delete', label: 'Delete' },
      { value: 'back', label: 'Back' },
    ],
  });
  if (handleCancel(action) || action === 'back') return;

  if (action === 'rename') {
    const next = await p.text({
      message: 'New filename',
      initialValue: model.name,
      validate: (v) => {
        if (!v?.trim()) return 'Required';
        if (/[/\\]/.test(v)) return 'Name only, no path separators';
      },
    });
    if (handleCancel(next)) return;
    try {
      const dest = renameModel(model.path, String(next).trim());
      p.log.success(`Renamed → ${path.basename(dest)}`);
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (action === 'family') {
    if (model.type !== 'checkpoint') {
      p.log.warn('Family mapping is only for checkpoints');
      return;
    }
    const families = listFamilies();
    const family = await p.select({
      message: 'Family',
      options: families.map((f) => ({
        value: f.id,
        label: f.name,
        hint: f.id === model.family ? 'current' : f.id,
      })),
    });
    if (handleCancel(family)) return;
    saveCheckpointFamily(model.name, /** @type {string} */ (family));
    p.log.success(`Mapped ${model.name} → ${family}`);
    return;
  }

  if (action === 'delete') {
    const ok = await p.confirm({
      message: `Delete ${model.name} permanently?`,
      initialValue: false,
    });
    if (handleCancel(ok) || !ok) {
      p.log.info('Not deleted');
      return;
    }
    try {
      deleteModel(model.path);
      p.log.success('Deleted');
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
    }
  }
}
