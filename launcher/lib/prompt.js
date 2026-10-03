import * as p from '@clack/prompts';

export function handleCancel(value) {
  if (p.isCancel(value)) {
    p.cancel('Cancelled.');
    return true;
  }
  return false;
}

export async function pauseReturn() {
  const ok = await p.confirm({
    message: 'Return to menu?',
    initialValue: true,
  });
  if (p.isCancel(ok) || ok === false) {
    p.outro('Bye');
    process.exit(0);
  }
}
