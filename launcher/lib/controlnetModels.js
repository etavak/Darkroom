import path from 'node:path';
import { loadComponents } from './dependencies.js';
import { listModels } from './models.js';

/** Model architecture per family: a ControlNet only works on its own architecture. */
export const FAMILY_ARCH = {
  sd15: 'sd15',
  sdxl: 'sdxl',
  illustrious: 'sdxl',
  noobai: 'sdxl',
  'noobai-vpred': 'sdxl',
  pony: 'sdxl',
  sd3: 'sd3',
  flux: 'flux',
  'flux-kontext': 'flux',
  'flux2-klein': 'flux2',
  anima: 'anima',
};

export const ARCH_LABELS = {
  sdxl: 'SDXL · Illustrious · NoobAI · Pony',
  sd15: 'SD 1.5',
  flux: 'Flux.1',
  sd3: 'SD3',
  flux2: 'Flux.2',
  anima: 'Anima',
};

/**
 * The curated ControlNet downloads (server/presets/components.json, type "controlnet").
 * @returns {import('./dependencies.js').ComponentDef[]}
 */
export function controlNetCatalog() {
  return [...loadComponents().values()].filter((c) => c.type === 'controlnet');
}

/** @param {string} name */
const stem = (name) => path.basename(name, path.extname(name)).toLowerCase();

/**
 * Which catalog entries are already installed (by file name; an install under the
 * pre-fix `dep-` name counts too).
 * @param {Array<{ name: string }>} [installed]
 * @returns {Set<string>} component ids
 */
export function installedControlNetIds(installed = listModels('controlnet')) {
  const names = new Set(installed.map((m) => stem(m.name).replace(/^dep-/, '')));
  return new Set(controlNetCatalog().filter((c) => names.has(stem(c.filename))).map((c) => c.id));
}

/**
 * Architectures of the image models installed here (checkpoints mapped to a family,
 * plus Flux / Flux.2 diffusion models by name).
 * @returns {Set<string>}
 */
export function installedArchitectures() {
  const out = new Set();
  for (const m of listModels('checkpoint')) {
    const arch = m.family ? FAMILY_ARCH[/** @type {keyof typeof FAMILY_ARCH} */ (m.family)] : null;
    if (arch) out.add(arch);
  }
  for (const m of listModels('diffusion')) {
    const n = m.name.toLowerCase();
    if (/flux[._-]?2|klein/.test(n)) out.add('flux2');
    else if (n.includes('flux')) out.add('flux');
  }
  return out;
}
