#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { controlnetModels } from './actions/controlnetModels.js';
import { updateAll } from './actions/update.js';
import { diagnostics } from './actions/diagnostics.js';
import {
  componentsMenu,
  doctorAction,
  installEverythingAction,
} from './actions/components.js';

const cliDir = path.dirname(fileURLToPath(import.meta.url));

/** Newest modification time of the launcher's own files (they load once, at startup). */
function launcherStamp() {
  let newest = 0;
  const walk = (/** @type {string} */ dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(js|json)$/.test(e.name)) newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  try {
    walk(cliDir);
  } catch {
    // unreadable — skip the check
  }
  return newest;
}

async function menuLoop() {
  const startedStamp = launcherStamp();
  if (!envFileExists()) {
    await runSetupWizard();
  }
  loadAndApplyEnv();

  await printBanner();
  p.intro('Darkroom');

  while (true) {
    if (launcherStamp() > startedStamp) {
      p.log.warn('The launcher was updated while it was open. Choose Quit and open it again to use the new version.');
    }
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
        { value: 'controlnet', label: 'ControlNet models', hint: 'pose · depth · edges guides' },
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
      controlnet: controlnetModels,
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
