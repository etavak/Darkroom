import * as p from '@clack/prompts';
import { handleCancel } from '../lib/prompt.js';
import {
  gitPullDarkroom,
  refreshTagCsvs,
  updateComfyUI,
} from '../lib/update.js';

export async function updateAll() {
  const { isRemoteMode } = await import('../lib/env.js');
  const remote = isRemoteMode();
  const choices = await p.multiselect({
    message: 'What should we update?',
    options: [
      { value: 'darkroom', label: 'Git pull Darkroom', hint: 'this repo' },
      ...(remote
        ? []
        : [{ value: 'comfy', label: 'Update ComfyUI', hint: 'git pull under COMFY_DIR' }]),
      { value: 'tags', label: 'Refresh tag CSVs', hint: 'danbooru + e621' },
    ],
    required: true,
  });
  if (handleCancel(choices)) return;

  if (choices.includes('darkroom')) {
    try {
      p.log.step('Updating Darkroom…');
      await gitPullDarkroom();
      p.log.success('Darkroom updated');
    } catch (err) {
      p.log.warn(err instanceof Error ? err.message : String(err));
    }
  }

  if (choices.includes('comfy')) {
    try {
      p.log.step('Updating ComfyUI…');
      await updateComfyUI();
      p.log.success('ComfyUI updated');
    } catch (err) {
      p.log.warn(err instanceof Error ? err.message : String(err));
    }
  }

  if (choices.includes('tags')) {
    const s = p.spinner();
    s.start('Downloading tag dictionaries…');
    try {
      await refreshTagCsvs();
      s.stop('Tag CSVs refreshed in server/tags/');
    } catch (err) {
      s.stop('Tag refresh failed');
      p.log.error(err instanceof Error ? err.message : String(err));
    }
  }
}
