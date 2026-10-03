import fs from 'node:fs';
import path from 'node:path';
import { downloadAndInstallComponent, loadComponents } from './dependencies.js';
import { listModels } from './models.js';
import { getComfyUiRoot } from './paths.js';

/** The face finder the detailer uses by default (server/presets/components.json). */
export const FACE_MODEL_ID = 'face_yolov8m';

export function faceModelComponent() {
  return loadComponents().get(FACE_MODEL_ID) ?? null;
}

/** The face finder is in models/ultralytics/bbox. */
export function faceModelInstalled() {
  const comp = faceModelComponent();
  const want = (comp?.filename ?? 'face_yolov8m.pt').toLowerCase();
  return listModels('detector').some((m) => m.name.toLowerCase() === want);
}

/**
 * Impact Subpack only loads older .pt detectors (pickled, like face_yolov8m.pt) on
 * PyTorch 2.6+ when they're listed in its whitelist. We list just the file we downloaded
 * from a pinned source and checked against its sha256.
 * @param {string} filename
 */
export function whitelistDetector(filename) {
  const ui = getComfyUiRoot(process.env.COMFY_DIR || '');
  if (!ui) return false;
  const dir = path.join(ui, 'user', 'default', 'ComfyUI-Impact-Subpack');
  const file = path.join(dir, 'model-whitelist.txt');
  fs.mkdirSync(dir, { recursive: true });
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const listed = text.split(/\r?\n/).some((l) => path.basename(l.trim()) === filename);
  if (!listed) {
    const header = text ? '' : '# Models allowed to load without weights_only (added by Darkroom after a checksum-verified download)\n';
    fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${header}${filename}\n`, 'utf8');
  }
  return true;
}

/**
 * Download the face finder (sha256-checked) into models/ultralytics/bbox and whitelist it.
 * @param {{ onProgress?: (done: number, total: number) => void }} [opts]
 */
export async function installFaceModel(opts = {}) {
  const comp = faceModelComponent();
  if (!comp) throw new Error('The face model is missing from server/presets/components.json');
  if (!faceModelInstalled()) {
    await downloadAndInstallComponent(comp, { quiet: true, onProgress: opts.onProgress });
  }
  whitelistDetector(comp.filename);
  return comp;
}
