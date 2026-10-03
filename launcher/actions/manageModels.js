import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { createModelLink } from '../lib/linkInstall.js';
import { updateModelLinkSource } from '../lib/modelLinksDb.js';
import {
  deleteModel,
  formatBytes,
  listFamilies,
  listModels,
  normalizeDraggedPath,
  renameModel,
  saveCheckpointFamily,
} from '../lib/models.js';
import { handleCancel } from '../lib/prompt.js';
import { MODEL_TYPE_OPTIONS } from '../lib/safetensors.js';

function modelHint(m) {
  const bits = [`${m.type}`, formatBytes(m.size)];
  if (m.family) bits.push(m.family);
  if (m.linkType && m.sourcePath) {
    bits.push(`linked from ${m.sourcePath}`);
  } else if (m.broken) {
    bits.push('broken link');
  }
  return bits.join(' · ');
}

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
      label: m.broken ? `⚠ ${m.name}` : m.name,
      hint: modelHint(m),
    })),
  });
  if (handleCancel(picked)) return;

  const model = models.find((m) => m.path === picked);
  if (!model) return;

  if (model.linkType && model.sourcePath) {
    p.note(
      `${model.linkType} → ${model.sourcePath}${model.broken ? '\n(broken — source missing)' : ''}`,
      'Linked model',
    );
  }

  const action = await p.select({
    message: model.name,
    options: [
      { value: 'rename', label: 'Rename' },
      {
        value: 'family',
        label: 'Change family',
        hint:
          model.type === 'checkpoint' || model.type === 'diffusion'
            ? undefined
            : 'checkpoints / diffusion',
      },
      ...(model.linkType || model.broken
        ? [{ value: 'relink', label: 'Relink…', hint: 'point at a new source path' }]
        : []),
      {
        value: 'delete',
        label: model.linkType ? 'Remove link' : 'Delete',
        hint: model.linkType ? 'keeps the original file' : 'permanent',
      },
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
    if (model.type !== 'checkpoint' && model.type !== 'diffusion') {
      p.log.warn('Family mapping is only for checkpoints / diffusion models');
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

  if (action === 'relink') {
    const raw = await p.text({
      message: 'New source file path',
      initialValue: model.sourcePath || '',
      validate: (v) => (!v?.trim() ? 'Path required' : undefined),
    });
    if (handleCancel(raw)) return;
    const src = normalizeDraggedPath(String(raw));
    try {
      try {
        fs.unlinkSync(model.path);
      } catch {
        // dest may already be missing
      }
      const { linkType } = createModelLink(src, model.path);
      updateModelLinkSource(model.path, src, linkType);
      p.log.success(`Relinked (${linkType}) → ${src}`);
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (action === 'delete') {
    const ok = await p.confirm({
      message: model.linkType
        ? `Remove link for ${model.name}? (original file is kept)`
        : `Delete ${model.name} permanently?`,
      initialValue: false,
    });
    if (handleCancel(ok) || !ok) {
      p.log.info('Not deleted');
      return;
    }
    try {
      const result = deleteModel(model.path);
      p.log.success(result.removedLinkOnly ? 'Link removed (original kept)' : 'Deleted');
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
    }
  }
}
