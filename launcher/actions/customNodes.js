import * as p from '@clack/prompts';
import { handleCancel } from '../lib/prompt.js';
import { createAllNodeComponents } from '../components/nodes.js';
import { formatStatusLine } from '../components/types.js';

export async function customNodes() {
  const nodes = createAllNodeComponents();
  const statuses = [];
  for (const n of nodes) {
    statuses.push({ comp: n, status: await n.status() });
  }
  p.note(
    statuses.map((s) => `${s.comp.name}: ${formatStatusLine(s.status)}`).join('\n'),
    'Custom nodes',
  );

  const missing = statuses.filter((s) => s.status.state === 'missing');
  if (missing.length === 0) {
    p.log.success('All listed nodes are installed');
    const manage = await p.confirm({
      message: 'Open Components for a specific node?',
      initialValue: false,
    });
    if (handleCancel(manage) || !manage) return;
  }

  const choice = await p.select({
    message: 'Custom node action',
    options: [
      ...statuses.map((s) => ({
        value: s.comp.id,
        label: s.comp.name,
        hint: formatStatusLine(s.status),
      })),
      { value: '', label: 'Back' },
    ],
  });
  if (handleCancel(choice) || !choice) return;

  const entry = statuses.find((s) => s.comp.id === choice);
  if (!entry) return;

  const action = await p.select({
    message: entry.comp.name,
    options: [
      { value: 'install', label: 'Install' },
      { value: 'update', label: 'Update' },
      { value: 'reinstall', label: 'Reinstall' },
      { value: 'uninstall', label: 'Uninstall' },
      { value: '', label: 'Back' },
    ],
  });
  if (handleCancel(action) || !action) return;

  try {
    if (action === 'install') await entry.comp.install({});
    else if (action === 'update') await entry.comp.update({ channel: 'tested' });
    else if (action === 'reinstall') await entry.comp.reinstall({});
    else if (action === 'uninstall') await entry.comp.uninstall({});
    p.log.success('Done — restart ComfyUI to load node changes.');
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
  }
}
