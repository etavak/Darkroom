import * as p from '@clack/prompts';
import { handleCancel } from '../lib/prompt.js';
import { listComponents, componentMenuLabel, getComponent } from '../components/registry.js';
import { installEverything, runDoctor } from '../components/orchestrator.js';
import { exitForRelaunch } from './update.js';

export async function componentsMenu() {
  while (true) {
    const comps = listComponents();
    /** @type {{ value: string, label: string, hint?: string }[]} */
    const options = [];
    for (const c of comps) {
      const st = await c.status();
      options.push({
        value: c.id,
        label: componentMenuLabel(c, st),
      });
    }
    options.push({ value: '', label: 'Back' });

    const pick = await p.select({
      message: 'Components',
      options,
    });
    if (handleCancel(pick) || !pick) return;

    const comp = getComponent(String(pick));
    if (!comp) return;

    const action = await p.select({
      message: comp.name,
      options: [
        { value: 'install', label: 'Install' },
        { value: 'update_tested', label: 'Update to tested' },
        { value: 'update_latest', label: 'Update to latest' },
        { value: 'repair', label: 'Repair' },
        { value: 'reinstall', label: 'Reinstall' },
        { value: 'uninstall', label: 'Uninstall' },
        { value: '', label: 'Back' },
      ],
    });
    if (handleCancel(action) || !action) continue;

    try {
      /** @type {{ restartRequired?: boolean } | void} */
      let result;
      if (action === 'install') await comp.install({ channel: 'tested' });
      else if (action === 'update_tested') result = await comp.update({ channel: 'tested' });
      else if (action === 'update_latest') result = await comp.update({ channel: 'latest' });
      else if (action === 'repair') await comp.repair({});
      else if (action === 'reinstall') await comp.reinstall({});
      else if (action === 'uninstall') await comp.uninstall({});
      p.log.success('Done');
      if (result?.restartRequired) exitForRelaunch();
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
    }
  }
}

export async function installEverythingAction() {
  await installEverything({});
}

export async function doctorAction() {
  await runDoctor();
}
