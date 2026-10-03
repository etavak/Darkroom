import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * npm test — three suites:
 *  server   workflows checked against a recorded ComfyUI object_info, services, the HTTP app
 *           (temp data folder + a fake ComfyUI; never your real data or ComfyUI)
 *  launcher the terminal launcher's libraries (scratch folders only)
 *  client   the app's pure logic
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/test/**/*.test.ts'],
          setupFiles: ['server/test/setup.ts'],
          // Each file gets a fresh module graph (config is read once at import)
          isolate: true,
          testTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'launcher',
          environment: 'node',
          include: ['launcher/test/**/*.test.js'],
          setupFiles: ['launcher/test/setup.js'],
          testTimeout: 20_000,
        },
      },
      {
        resolve: { alias: { '@': path.resolve(__dirname, 'client/src') } },
        test: {
          name: 'client',
          environment: 'node',
          include: ['client/src/**/*.test.ts'],
        },
      },
    ],
  },
});
