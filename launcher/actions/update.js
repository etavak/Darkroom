import * as p from '@clack/prompts';
import { handleCancel } from '../lib/prompt.js';
import { getComponent } from '../components/registry.js';
import { isRemoteMode } from '../lib/env.js';
import { withComfyStopped } from '../lib/comfy.js';
import { defaultConfirm } from '../components/types.js';

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
      ...(remote ? [] : [{ value: 'comfyui', label: 'ComfyUI', hint: 'in place — models and custom nodes stay' }]),
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
  const runAll = async (/** @type {boolean} */ comfyStopped) => {
    for (const id of ordered) {
      const comp = getComponent(String(id));
      if (!comp) continue;
      try {
        p.log.step(`Updating ${comp.name}…`);
        const result = await comp.update({ channel, comfyStopped });
        if (result?.restartRequired) restartRequired = true;
        p.log.success(`${comp.name} updated`);
      } catch (err) {
        p.log.warn(`${comp.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
  };
  // ComfyUI and PyTorch need ComfyUI stopped (Windows can't replace files it has open):
  // stop it once for the whole batch, and start it again at the end
  if (ordered.some((id) => id === 'comfyui' || id === 'torch')) {
    try {
      await withComfyStopped(defaultConfirm, () => runAll(true));
    } catch (err) {
      p.log.warn(err instanceof Error ? err.message : String(err));
    }
  } else {
    await runAll(false);
  }
  if (restartRequired) exitForRelaunch();
}

/** The CLI's own files were replaced — stop so the next launch runs the new code. */
export function exitForRelaunch() {
  p.outro(
    process.platform === 'win32'
      ? 'Darkroom was updated. Open "Start Darkroom (Windows).bat" again to continue.'
      : process.platform === 'darwin'
        ? 'Darkroom was updated. Open "Start Darkroom (Mac).command" again to continue.'
        : 'Darkroom was updated. Run ./launcher/start-linux.sh again to continue.',
  );
  process.exit(0);
}
