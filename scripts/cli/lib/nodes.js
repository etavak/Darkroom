import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './env.js';
import {
  getComfyPython,
  getComfyUiRoot,
  getCustomNodesDir,
} from './paths.js';
import { runCommand } from './process.js';

/** @type {Array<{ id: string, name: string, repo: string, dir: string }>} */
export const KNOWN_NODES = [
  {
    id: 'controlnet-aux',
    name: 'ControlNet Aux',
    repo: 'https://github.com/Fannovel16/comfyui_controlnet_aux.git',
    dir: 'comfyui_controlnet_aux',
  },
  {
    id: 'impact-pack',
    name: 'Impact Pack',
    repo: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack.git',
    dir: 'ComfyUI-Impact-Pack',
  },
  {
    id: 'ipadapter-plus',
    name: 'IPAdapter Plus',
    repo: 'https://github.com/cubiq/ComfyUI_IPAdapter_plus.git',
    dir: 'ComfyUI_IPAdapter_plus',
  },
];

export function listCustomNodeStatus() {
  const custom = getCustomNodesDir();
  return KNOWN_NODES.map((n) => {
    const installed = Boolean(custom && fs.existsSync(path.join(custom, n.dir)));
    return { ...n, installed, path: custom ? path.join(custom, n.dir) : null };
  });
}

/**
 * @param {typeof KNOWN_NODES[number]} node
 */
export async function installCustomNode(node) {
  const cfg = getConfig();
  const custom = getCustomNodesDir(cfg.comfyDir);
  const ui = getComfyUiRoot(cfg.comfyDir);
  if (!custom || !ui) throw new Error('Set COMFY_DIR in .env first');
  fs.mkdirSync(custom, { recursive: true });
  const dest = path.join(custom, node.dir);
  if (fs.existsSync(dest)) throw new Error(`Already installed: ${node.dir}`);

  await runCommand('git', ['clone', '--depth', '1', node.repo, dest], {
    cwd: custom,
    stdio: 'inherit',
  });

  const python = getComfyPython(cfg.comfyDir);
  const req = path.join(dest, 'requirements.txt');
  if (fs.existsSync(req)) {
    await runCommand(python, ['-m', 'pip', 'install', '-r', req], {
      cwd: dest,
      stdio: 'inherit',
    });
  }
  // Impact Pack sometimes uses install.py
  const installPy = path.join(dest, 'install.py');
  if (fs.existsSync(installPy)) {
    await runCommand(python, [installPy], { cwd: dest, stdio: 'inherit' });
  }
}
