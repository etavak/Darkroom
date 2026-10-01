import * as p from '@clack/prompts';
import { handleCancel } from '../lib/prompt.js';
import { getComponent } from '../components/registry.js';
import { isRemoteMode } from '../lib/env.js';

/**
 * Update shortcut — delegates to component update(channel: tested|latest).
 */
export async function updateAll() {
  const remote = isRemoteMode();
  const channelPick = await p.select({
    message: 'Update channel',
    options: [
      { value: 'tested', label: 'Update to tested', hint: 'pinned in components.json' },
      { value: 'latest', label: 'Update to latest', hint: 'newest upstream' },
    ],
  });
  if (handleCancel(channelPick)) return;
  const channel = /** @type {'tested' | 'latest'} */ (channelPick);

  const choices = await p.multiselect({
    message: 'What should we update?',
    options: [
      { value: 'darkroom', label: 'Darkroom', hint: 'git pull + npm ci' },
      ...(remote ? [] : [{ value: 'comfyui', label: 'ComfyUI', hint: 'git pull / portable' }]),
      ...(remote ? [] : [{ value: 'torch', label: 'PyTorch' }]),
      { value: 'tags', label: 'Tag CSVs' },
      ...(remote ? [] : [{ value: 'taesd', label: 'TAESD' }]),
      ...(remote ? [] : [{ value: 'node', label: 'Portable Node' }]),
    ],
    required: true,
  });
  if (handleCancel(choices)) return;

  for (const id of choices) {
    const comp = getComponent(String(id));
    if (!comp) continue;
    try {
      p.log.step(`Updating ${comp.name}…`);
      await comp.update({ channel });
      p.log.success(`${comp.name} updated`);
    } catch (err) {
      p.log.warn(`${comp.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
