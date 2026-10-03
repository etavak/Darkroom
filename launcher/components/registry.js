import { nodeComponent } from './node.js';
import { gitComponent } from './git.js';
import { pythonComponent } from './python.js';
import { comfyuiComponent } from './comfyui.js';
import { torchComponent } from './torch.js';
import { taesdComponent } from './taesd.js';
import { tagsComponent } from './tags.js';
import { darkroomComponent } from './darkroom.js';
import { createAllNodeComponents, listCudaOnlyInstalledOnMac } from './nodes.js';
import { formatStatusLine } from './types.js';

/**
 * Install / status order.
 * @returns {import('./types.js').Component[]}
 */
export function listComponents() {
  return [
    nodeComponent,
    gitComponent,
    pythonComponent,
    comfyuiComponent,
    torchComponent,
    taesdComponent,
    tagsComponent,
    ...createAllNodeComponents(),
    darkroomComponent,
  ];
}

/**
 * @param {string} id
 */
export function getComponent(id) {
  return listComponents().find((c) => c.id === id) || null;
}

/**
 * Components required for a local "Install everything" (skips optional nodes).
 * @returns {import('./types.js').Component[]}
 */
export function listCoreInstallOrder() {
  return listComponents().filter((c) => !c.optional || c.id === 'taesd' || c.id === 'tags');
}

/**
 * @param {import('./types.js').Component} comp
 * @param {import('./types.js').ComponentStatus} status
 */
export function componentMenuLabel(comp, status) {
  return `${comp.name} — ${formatStatusLine(status)}`;
}

export { listCudaOnlyInstalledOnMac, formatStatusLine };
