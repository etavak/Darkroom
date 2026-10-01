import fs from 'node:fs';
import * as p from '@clack/prompts';
import { envPath } from '../lib/paths.js';
import { printBanner } from '../lib/banner.js';
import { handleCancel } from '../lib/prompt.js';
import { detectComfyInstalls, validateComfyInstall } from './detect.js';
import {
  configureExistingAndRepair,
  configureRemote,
  installEverything,
} from '../components/orchestrator.js';
import { normalizeDraggedPath } from './installFlow.js';

/**
 * First-run wizard when .env is missing — thin chooser over component modules.
 * @returns {Promise<void>}
 */
export async function runSetupWizard() {
  if (fs.existsSync(envPath)) return;

  await printBanner();
  p.intro('Darkroom setup');
  p.note(
    [`OS: ${process.platform} (${process.arch})`, 'No .env found — connect or install ComfyUI.'].join(
      '\n',
    ),
    'Welcome',
  );

  const mode = await p.select({
    message: 'How will you use ComfyUI?',
    options: [
      {
        value: 'install',
        label: 'Install everything',
        hint:
          process.platform === 'win32'
            ? 'portable ComfyUI + deps'
            : 'git clone + uv Python 3.12 + torch (MPS)',
      },
      {
        value: 'existing',
        label: 'Use existing ComfyUI',
        hint: 'source, portable, or Desktop app',
      },
      {
        value: 'remote',
        label: 'Remote ComfyUI',
        hint: 'URL only · must use --listen',
      },
    ],
  });
  if (handleCancel(mode)) process.exit(0);

  if (mode === 'remote') {
    p.log.warn(
      'Remote ComfyUI must be started with --listen 0.0.0.0 (or your LAN IP), not just localhost.',
    );
    const url = await p.text({
      message: 'ComfyUI base URL',
      placeholder: 'http://192.168.1.10:8188',
      initialValue: 'http://127.0.0.1:8188',
      validate: (v) => {
        if (!v?.trim()) return 'URL required';
        try {
          new URL(v.trim());
        } catch {
          return 'Invalid URL';
        }
      },
    });
    if (handleCancel(url)) process.exit(0);
    await configureRemote(String(url).trim());
  } else if (mode === 'existing') {
    const detected = detectComfyInstalls();
    /** @type {string} */
    let chosenKey = '';

    if (detected.length > 0) {
      const pick = await p.select({
        message: 'Detected ComfyUI installs',
        options: [
          ...detected.map((d, i) => ({
            value: String(i),
            label: d.label,
            hint: d.port ? `port ${d.port}` : d.kind,
          })),
          { value: '__paste__', label: 'Paste a different path…' },
        ],
      });
      if (handleCancel(pick)) process.exit(0);
      chosenKey = String(pick);
    } else {
      chosenKey = '__paste__';
    }

    /** @type {import('./detect.js').DetectedComfy | null} */
    let target = null;
    if (chosenKey !== '__paste__') {
      target = detected[Number(chosenKey)] || null;
    }

    if (!target || target.kind === 'desktop-config' || !target.python) {
      const raw = await p.text({
        message: 'Path to ComfyUI (folder with main.py, or Windows portable root)',
        placeholder:
          process.platform === 'win32'
            ? 'C:\\Users\\you\\ComfyUI_windows_portable'
            : '~/ComfyUI',
        validate: (v) => (!v?.trim() ? 'Path required' : undefined),
      });
      if (handleCancel(raw)) process.exit(0);
      const validated = validateComfyInstall(normalizeDraggedPath(String(raw)));
      if (!validated) {
        p.log.error('Could not validate that path.');
        process.exit(1);
      }
      target = {
        ...validated,
        port: target?.port,
        url: target?.url,
      };
    }

    if (!target.python) {
      p.log.error('Selected install has no Python — pick a full ComfyUI folder.');
      process.exit(1);
    }

    p.log.success(`Using ${target.kind}: ${target.comfyDir}`);
    if (target.port) p.log.info(`Desktop port: ${target.port}`);
    await configureExistingAndRepair(target);
  } else {
    try {
      await installEverything({});
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  p.outro('Setup complete — opening Darkroom menu');
}
