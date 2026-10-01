import { startStack } from './startDarkroom.js';

export async function startBackend() {
  await startStack({ openBrowser: false, printLan: true });
}
