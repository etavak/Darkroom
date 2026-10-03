import * as p from '@clack/prompts';
import { handleCancel } from '../lib/prompt.js';
import { legacyLayout, servicesRunning, tidyFolders } from '../lib/tidyFolders.js';

/**
 * Older installs put ComfyUI and the portable tools straight in the Darkroom folder;
 * new ones use dependencies/. Moves them there (a rename on the same disk).
 */
export async function tidyFoldersAction() {
  const what = legacyLayout();
  if (!what.comfy && !what.runtime) {
    p.log.success('Everything Darkroom downloads is already in dependencies/.');
    return;
  }
  const list = [what.comfy ? 'ComfyUI (with its models)' : null, what.runtime ? 'the portable tools (runtime/)' : null].filter(Boolean);
  p.note(
    `Moves ${list.join(' and ')} into dependencies/, so the Darkroom folder only shows Darkroom.\n` +
      'Same disk, so nothing is copied — it takes a moment. Settings and model links are updated.',
    'Tidy up folders',
  );

  const running = await servicesRunning();
  if (running.server || running.comfy) {
    p.log.warn(
      `${[running.comfy ? 'ComfyUI' : null, running.server ? 'the Darkroom server' : null].filter(Boolean).join(' and ')} must be stopped first — choose Stop everything, then Tidy up folders again.`,
    );
    return;
  }
  const ok = await p.confirm({ message: 'Move them now?', initialValue: true });
  if (handleCancel(ok) || !ok) return;

  try {
    const r = tidyFolders(what);
    for (const m of r.moved) p.log.success(`Moved ${m}`);
    for (const n of r.notes) p.log.info(n);
  } catch (err) {
    p.log.error(`Couldn't finish moving: ${err instanceof Error ? err.message : String(err)}. Anything already moved works from its new place; the rest stays where it was.`);
    return;
  }
  p.outro('Done. Open the launcher again so it uses the new folders.');
  process.exit(0);
}
