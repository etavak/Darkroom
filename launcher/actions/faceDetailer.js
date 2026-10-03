import * as p from '@clack/prompts';
import { handleCancel } from '../lib/prompt.js';
import { loadAndApplyEnv } from '../lib/env.js';
import { formatBytes } from '../lib/download.js';
import { faceModelComponent, faceModelInstalled, installFaceModel } from '../lib/faceDetailer.js';
import { createAllNodeComponents } from '../components/nodes.js';

/**
 * Everything the face detailer needs: Impact Pack (FaceDetailer), Impact Subpack (finds
 * the faces) and a face model. Installs whatever is missing.
 */
export async function faceDetailerSetup() {
  loadAndApplyEnv();
  const nodes = createAllNodeComponents();
  const parts = [
    { id: 'node:impact-pack', why: 'redraws the faces' },
    { id: 'node:impact-subpack', why: 'finds the faces' },
  ].map((x) => ({ ...x, comp: nodes.find((n) => n.id === x.id) }));

  /** @type {Array<{ name: string, missing: boolean, why: string }>} */
  const rows = [];
  for (const part of parts) {
    const st = part.comp ? await part.comp.status() : { state: 'missing' };
    rows.push({ name: part.comp?.name ?? part.id, missing: st.state === 'missing', why: part.why });
  }
  const model = faceModelComponent();
  const modelMissing = !faceModelInstalled();
  rows.push({ name: model?.title ?? 'Face model', missing: modelMissing, why: `the face finder · ${formatBytes(model?.sizeBytes ?? 0)}` });

  p.note(rows.map((r) => `${r.missing ? '○' : '✓'} ${r.name} — ${r.why}`).join('\n'), 'Face detailer');
  const missing = rows.filter((r) => r.missing);
  if (!missing.length) {
    p.log.success('The face detailer has everything it needs.');
    return;
  }

  const ok = await p.confirm({ message: `Install ${missing.map((r) => r.name).join(', ')}?`, initialValue: true });
  if (handleCancel(ok) || !ok) return;

  let nodesChanged = false;
  for (const part of parts) {
    const row = rows.find((r) => r.name === (part.comp?.name ?? part.id));
    if (!row?.missing || !part.comp) continue;
    p.log.step(`Installing ${part.comp.name}…`);
    try {
      await part.comp.install({});
      nodesChanged = true;
      p.log.success(`${part.comp.name} installed`);
    } catch (err) {
      p.log.error(`${part.comp.name}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }

  const s = p.spinner();
  s.start(`${model?.title ?? 'Face model'} — starting…`);
  try {
    let last = 0;
    await installFaceModel({
      onProgress: (done, total) => {
        if (Date.now() - last < 250) return;
        last = Date.now();
        s.message(`${model?.title ?? 'Face model'} — ${total ? Math.floor((done / total) * 100) : 0}%`);
      },
    });
    s.stop(`${model?.title ?? 'Face model'} ready (checked sha256)`);
  } catch (err) {
    s.stop('Face model failed');
    p.log.error(err instanceof Error ? err.message : String(err));
    return;
  }

  if (nodesChanged) {
    p.log.warn('Restart ComfyUI to load the new custom nodes: Stop everything, then Start Darkroom.');
  } else {
    p.log.info('Darkroom picks up the face model within a few seconds — no restart needed.');
  }
}
