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
      { value: 'darkroom', label: 'Darkroom', hint: 'latest from GitHub' },
      ...(remote ? [] : [{ value: 'comfyui', label: 'ComfyUI', hint: 'git pull / portable' }]),
      ...(remote ? [] : [{ value: 'torch', label: 'PyTorch' }]),
      { value: 'tags', label: 'Tag CSVs' },
      ...(remote ? [] : [{ value: 'taesd', label: 'TAESD' }]),
      ...(remote ? [] : [{ value: 'node', label: 'Portable Node' }]),
    ],
    required: true,
  });
  if (handleCancel(choices)) return;

  // Darkroom last: updating it replaces the CLI that is running right now
  const ordered = [...choices].sort((a, b) => Number(a === 'darkroom') - Number(b === 'darkroom'));
  let restartRequired = false;
  for (const id of ordered) {
    const comp = getComponent(String(id));
    if (!comp) continue;
    try {
      p.log.step(`Updating ${comp.name}…`);
      const result = await comp.update({ channel });
      if (result?.restartRequired) restartRequired = true;
      p.log.success(`${comp.name} updated`);
    } catch (err) {
      p.log.warn(`${comp.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (restartRequired) exitForRelaunch();
}

/** The CLI's own files were replaced — stop so the next launch runs the new code. */
export function exitForRelaunch() {
  p.outro(
    process.platform === 'win32'
      ? 'Darkroom was updated. Open Darkroom.bat again to continue.'
      : 'Darkroom was updated. Open Darkroom.command (or Darkroom.sh) again to continue.',
  );
  process.exit(0);
}
