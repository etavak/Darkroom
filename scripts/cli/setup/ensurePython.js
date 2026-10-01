import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { handleCancel } from '../lib/prompt.js';
import { runCommand } from '../lib/process.js';
import {
  findSystemPythonInfo,
  PYTHON_MAX_PREFERRED,
  PYTHON_MIN,
} from './detect.js';

/**
 * @param {[number, number]} version
 */
export function isPreferredPythonVersion(version) {
  const [a, b] = version;
  if (a < PYTHON_MIN[0] || (a === PYTHON_MIN[0] && b < PYTHON_MIN[1])) return false;
  if (a > PYTHON_MAX_PREFERRED[0] || (a === PYTHON_MAX_PREFERRED[0] && b > PYTHON_MAX_PREFERRED[1])) {
    return false;
  }
  return true;
}

/**
 * @returns {{ manager: 'brew' | 'winget' | 'apt', packageName: string, label: string, command: string, args: string[] } | null}
 */
export function detectPythonInstallMethod() {
  if (process.platform === 'darwin') {
    const brew = spawnSync('brew', ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    });
    if (brew.status === 0) {
      return {
        manager: 'brew',
        packageName: 'python@3.12',
        label: 'Homebrew python@3.12',
        command: 'brew',
        args: ['install', 'python@3.12'],
      };
    }
    return null;
  }

  if (process.platform === 'win32') {
    const winget = spawnSync('winget', ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    });
    if (winget.status === 0) {
      return {
        manager: 'winget',
        packageName: 'Python.Python.3.12',
        label: 'winget Python 3.12',
        command: 'winget',
        args: [
          'install',
          '-e',
          '--id',
          'Python.Python.3.12',
          '--accept-package-agreements',
          '--accept-source-agreements',
        ],
      };
    }
    return null;
  }

  // Linux — prefer apt when available
  const apt = spawnSync('apt-get', ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  if (apt.status === 0) {
    return {
      manager: 'apt',
      packageName: 'python3.12',
      label: 'apt python3.12 (+ venv)',
      command: 'sudo',
      args: ['apt-get', 'install', '-y', 'python3.12', 'python3.12-venv'],
    };
  }
  return null;
}

/**
 * After brew install, put python3.12 on PATH for this process.
 */
function refreshBrewPythonPath() {
  const prefix = spawnSync('brew', ['--prefix', 'python@3.12'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  if (prefix.status !== 0 || !prefix.stdout?.trim()) return;
  const bin = path.join(prefix.stdout.trim(), 'bin');
  if (fs.existsSync(bin)) {
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH || ''}`;
  }
}

/**
 * After winget install, common install locations may not be on PATH yet.
 */
function refreshWindowsPythonPath() {
  const local = process.env.LOCALAPPDATA;
  if (!local) return;
  const candidates = [
    path.join(local, 'Programs', 'Python', 'Python312'),
    path.join(local, 'Programs', 'Python', 'Python3.12'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'python.exe'))) {
      process.env.PATH = `${dir}${path.delimiter}${path.join(dir, 'Scripts')}${path.delimiter}${process.env.PATH || ''}`;
      return;
    }
  }
}

/**
 * Install Python 3.12 via the detected package manager and refresh PATH.
 * @returns {Promise<boolean>} true if install command succeeded
 */
export async function installPreferredPython() {
  const method = detectPythonInstallMethod();
  if (!method) {
    p.log.error(
      'No package manager available to install Python automatically (need Homebrew, winget, or apt).',
    );
    return false;
  }

  p.log.step(`Installing ${method.label}…`);
  try {
    await runCommand(method.command, method.args, { stdio: 'inherit' });
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
    return false;
  }

  if (method.manager === 'brew') refreshBrewPythonPath();
  if (method.manager === 'winget') refreshWindowsPythonPath();

  const info = findSystemPythonInfo();
  if (info && isPreferredPythonVersion(info.version)) {
    p.log.success(`Python ready: ${info.executable} (${info.version[0]}.${info.version[1]})`);
    return true;
  }

  p.log.warn(
    'Python 3.12 may be installed but not on PATH yet. Open a new terminal, or re-run Install / reconfigure.',
  );
  return Boolean(info);
}

/**
 * Ensure we have a preferred Python, offering to install 3.12 when missing / only 3.14.
 * @param {{ reason?: string, forceOffer?: boolean }} [opts]
 * @returns {Promise<{ executable: string, version: [number, number] } | null>}
 */
export async function ensurePreferredPython(opts = {}) {
  let info = findSystemPythonInfo();
  const preferred = info && isPreferredPythonVersion(info.version);
  if (preferred && !opts.forceOffer) return info;

  const method = detectPythonInstallMethod();
  if (!method) {
    if (!info) {
      p.log.error(
        'No suitable Python found (need 3.10–3.13). Install Python 3.12 from https://www.python.org/downloads/ then retry.',
      );
    }
    return info;
  }

  const reason =
    opts.reason ||
    (!info
      ? 'No suitable Python found (need 3.10–3.13 for a reliable ComfyUI install).'
      : `Found Python ${info.version[0]}.${info.version[1]} — 3.12 is more reliable for ComfyUI dependencies.`);

  p.note(reason, 'Python');

  const ok = await p.confirm({
    message: `Install ${method.label} now?`,
    initialValue: true,
  });
  if (handleCancel(ok) || !ok) return info;

  const installed = await installPreferredPython();
  info = findSystemPythonInfo();
  if (!installed && !info) return null;
  return info;
}
