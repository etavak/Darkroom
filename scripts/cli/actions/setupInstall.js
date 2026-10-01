import * as p from '@clack/prompts';
import { handleCancel } from '../lib/prompt.js';
import {
  configureExistingAndRepair,
  configureRemote,
} from '../components/orchestrator.js';
import {
  configureRemoteInteractive,
  pickExistingComfyInteractive,
} from '../setup/installFlow.js';

/**
 * Thin wrapper over Components / Install everything / Doctor.
 */
export async function setupInstall() {
  const choice = await p.select({
    message: 'Install / reconfigure',
    options: [
      { value: 'components', label: 'Open Components menu', hint: 'full control' },
      { value: 'all', label: 'Install everything', hint: 'missing components in order' },
      { value: 'existing', label: 'Point to existing ComfyUI' },
      { value: 'remote', label: 'Use remote ComfyUI' },
      { value: 'doctor', label: 'Doctor', hint: 'diagnose + repair' },
    ],
  });
  if (handleCancel(choice)) return;

  if (choice === 'components') {
    const { componentsMenu } = await import('./components.js');
    await componentsMenu();
    return;
  }
  if (choice === 'all') {
    const { installEverythingAction } = await import('./components.js');
    await installEverythingAction();
    return;
  }
  if (choice === 'doctor') {
    const { doctorAction } = await import('./components.js');
    await doctorAction();
    return;
  }
  if (choice === 'remote') {
    const remote = await configureRemoteInteractive();
    if (!remote) return;
    await configureRemote(remote.COMFY_URL);
    return;
  }
  if (choice === 'existing') {
    const validated = await pickExistingComfyInteractive();
    if (!validated) return;
    await configureExistingAndRepair(validated);
  }
}
