#!/usr/bin/env node
import * as p from '@clack/prompts';
import { envFileExists, isRemoteMode, loadAndApplyEnv } from './lib/env.js';
import { printBanner } from './lib/banner.js';
import { formatStatusHeader, getServiceStatus } from './lib/status.js';
import { pauseReturn } from './lib/prompt.js';
import { runSetupWizard } from './setup/wizard.js';
import { startDarkroom } from './actions/startDarkroom.js';
import { startBackend } from './actions/startBackend.js';
import { stopEverything } from './actions/stopEverything.js';
import { restartServerAction } from './actions/restartServer.js';
import { phonesAndTablets } from './actions/devices.js';
import { installModelFromFile } from './actions/installModel.js';
import { downloadModelFromUrl } from './actions/downloadModel.js';
import { manageModels } from './actions/manageModels.js';
import { customNodes } from './actions/customNodes.js';
import { updateAll } from './actions/update.js';
import { diagnostics } from './actions/diagnostics.js';
import {
  componentsMenu,
  doctorAction,
  installEverythingAction,
} from './actions/components.js';

async function menuLoop() {
  if (!envFileExists()) {
    await runSetupWizard();
  }
  loadAndApplyEnv();

  await printBanner();
  p.intro('Darkroom');

  while (true) {
    const remote = isRemoteMode();
    const status = await getServiceStatus();
    p.note(
      formatStatusHeader(status) +
        (remote ? '\nMode: remote (local ComfyUI start + model tools hidden)' : ''),
      'Status',
    );

    /** @type {{ value: string, label: string, hint?: string }[]} */
    const allUp = status.server && (status.comfy || remote);
    const updateReady = status.server && (status.stale.server || status.stale.client);
    const options = [
      {
        value: 'start',
        label: 'Start Darkroom',
        hint: allUp
          ? updateReady
            ? 'applies the update · opens the browser'
            : 'already running · opens the browser'
          : remote
            ? 'server + browser (remote ComfyUI)'
            : 'ComfyUI + server + browser',
      },
      {
        value: 'backend',
        label: 'Start backend only',
        hint: remote ? 'server only · print phone address + PIN' : 'no browser · print phone address + PIN',
      },
    ];
    if (status.server) {
      options.push(
        { value: 'restart', label: 'Restart server', hint: updateReady ? 'update ready · ComfyUI keeps running' : 'ComfyUI keeps running' },
        { value: 'devices', label: 'Phones & tablets', hint: 'address · PIN · signed-in devices' },
      );
    }
    options.push({ value: 'stop', label: 'Stop everything' });

    if (!remote) {
      options.push(
        { value: 'install', label: 'Install model from file' },
        { value: 'download', label: 'Download model from URL' },
        { value: 'manage', label: 'Manage models' },
        { value: 'nodes', label: 'Custom nodes' },
      );
    }

    options.push(
      {
        value: 'install_all',
        label: 'Install everything',
        hint: remote ? 'switch to local stack' : 'missing components in order',
      },
      {
        value: 'components',
        label: 'Components',
        hint: 'status · install · update · repair',
      },
      {
        value: 'doctor',
        label: 'Doctor',
        hint: 'diagnose + repair',
      },
      { value: 'update', label: 'Update' },
      { value: 'diag', label: 'Diagnostics' },
      { value: 'quit', label: 'Quit' },
    );

    const choice = await p.select({
      message: 'What do you want to do?',
      options,
    });

    if (p.isCancel(choice) || choice === 'quit') {
      p.outro('Bye — background services left as-is (use Stop everything to shut them down).');
      process.exit(0);
    }

    const ACTIONS = {
      start: startDarkroom,
      backend: startBackend,
      stop: stopEverything,
      restart: restartServerAction,
      devices: phonesAndTablets,
      install: installModelFromFile,
      download: downloadModelFromUrl,
      manage: manageModels,
      nodes: customNodes,
      install_all: installEverythingAction,
      components: componentsMenu,
      doctor: doctorAction,
      update: updateAll,
      diag: diagnostics,
    };

    const action = ACTIONS[/** @type {keyof typeof ACTIONS} */ (choice)];
    if (!action) continue;

    try {
      await action();
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
    }

    await pauseReturn();
  }
}

menuLoop().catch((err) => {
  console.error(err);
  process.exit(1);
});
