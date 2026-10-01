import * as p from '@clack/prompts';
import { installCustomNode, listCustomNodeStatus } from '../lib/nodes.js';
import { handleCancel } from '../lib/prompt.js';

export async function customNodes() {
  const status = listCustomNodeStatus();
  const lines = status.map((n) => `${n.installed ? '✓' : '✗'}  ${n.name}`).join('\n');
  p.note(lines, 'Custom nodes');

  const missing = status.filter((n) => !n.installed);
  if (missing.length === 0) {
    p.log.success('All listed nodes are installed');
    return;
  }

  const choice = await p.select({
    message: 'Install a node?',
    options: [
      ...missing.map((n) => ({ value: n.id, label: n.name })),
      { value: '', label: 'Back' },
    ],
  });
  if (handleCancel(choice) || !choice) return;

  const node = missing.find((n) => n.id === choice);
  if (!node) return;

  try {
    p.log.step(`Installing ${node.name} (git + pip)…`);
    await installCustomNode(node);
    p.log.success(`Installed ${node.name}`);
    p.log.info('Restart ComfyUI to load the new node.');
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
  }
}
