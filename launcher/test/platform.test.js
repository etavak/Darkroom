import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { gpuFromNames } from '../lib/hardware.js';
import { safeFileName } from '../lib/download.js';
import { listModelLinks, rebaseModelLinks, upsertModelLink } from '../lib/modelLinksDb.js';
import { normalizeDraggedPath } from '../lib/models.js';
import { listPortableNodes } from '../lib/paths.js';
import { listeningProcesses, resolveNpmCli, runCommand, withPathFirst } from '../lib/process.js';
import { torchIndexFor } from '../components/torch.js';
import { pickPortableAsset } from '../setup/installComfy.js';
import { writeEnvFile } from '../setup/writeEnv.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

describe('running programs', () => {
  it('puts a folder first on the search path without leaving two PATH variables (Windows spells it Path)', () => {
    const env = withPathFirst({ Path: 'C:\\Windows', PATH: 'stale', HOME: 'h' }, 'C:\\node');
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH')).toEqual(['Path']);
    expect(env.Path).toBe(`C:\\node${path.delimiter}C:\\Windows`);
    expect(withPathFirst({ PATH: '/usr/bin' }, '/node').PATH).toBe(`/node${path.delimiter}/usr/bin`);
  });

  it("finds npm's own script next to Node in both download layouts (run without a shell)", () => {
    const make = (/** @type {string} */ rel) => {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
      return file;
    };
    // node-v22-win-x64\node.exe + node_modules\npm
    make('win/node_modules/npm/bin/npm-cli.js');
    expect(resolveNpmCli(make('win/node.exe'))).toBe(path.join(dir, 'win', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    // node-v22-darwin-arm64/bin/node + lib/node_modules/npm
    make('mac/lib/node_modules/npm/bin/npm-cli.js');
    expect(resolveNpmCli(make('mac/bin/node'))).toBe(path.join(dir, 'mac', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  });

  // npm.cmd and other .cmd files from a folder with a space in its name (C:\Users\John Smith\…)
  it.runIf(process.platform === 'win32')('runs a .cmd from a path with spaces, arguments intact', async () => {
    const folder = path.join(dir, 'with space');
    fs.mkdirSync(folder);
    const out = path.join(folder, 'out.txt');
    fs.writeFileSync(path.join(folder, 'echo args.cmd'), `@echo off\r\necho %~1^|%~2> "${out}"\r\n`);
    await runCommand(path.join(folder, 'echo args.cmd'), ['two words', 'x&y'], { stdio: 'ignore' });
    expect(fs.readFileSync(out, 'utf8').trim()).toBe('two words|x&y');
  });

  it('sees which process listens on a port (lsof on macOS / Linux, netstat on Windows)', async () => {
    const server = http.createServer(() => {});
    await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
    try {
      const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
      const procs = listeningProcesses(port);
      expect(procs.map((p) => p.pid)).toContain(process.pid);
      expect(procs.find((p) => p.pid === process.pid)?.cmd.toLowerCase()).toMatch(/node/);
    } finally {
      server.close();
    }
  });
});

describe('portable Node', () => {
  it('uses the newest version installed (not whichever sorts first)', () => {
    const nodeDir = path.join(dir, 'node');
    for (const v of ['22.9.0', '22.14.0', '22.12.1']) {
      const name = `node-v${v}-${process.platform === 'win32' ? 'win' : process.platform}-x64`;
      const bin = process.platform === 'win32' ? path.join(nodeDir, name, 'node.exe') : path.join(nodeDir, name, 'bin', 'node');
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      fs.writeFileSync(bin, '');
    }
    expect(listPortableNodes(nodeDir).map((n) => n.version.join('.'))).toEqual(['22.14.0', '22.12.1', '22.9.0']);
  });
});

describe('ComfyUI for this PC (Windows builds)', () => {
  // ComfyUI v0.38.0's Windows downloads
  const assets = ['amd', 'intel', 'nvidia', 'nvidia_cu126'].map((f) => ({
    name: `ComfyUI_windows_portable_${f}.7z`,
    browser_download_url: `https://x/${f}.7z`,
  }));
  const pick = (gpu) => {
    const r = pickPortableAsset(assets, { name: null, computeCap: null, ...gpu });
    return `${r.asset?.name.replace(/^ComfyUI_windows_portable_|\.7z$/g, '')}${r.cpu ? ' --cpu' : ''}`;
  };

  it('matches the graphics card', () => {
    expect(pick({ vendor: 'nvidia', computeCap: 8.9 })).toBe('nvidia');
    expect(pick({ vendor: 'nvidia', computeCap: 6.1 })).toBe('nvidia_cu126'); // GTX 10 series: CUDA 13 dropped it
    expect(pick({ vendor: 'nvidia' })).toBe('nvidia'); // old driver: no compute capability reported
    expect(pick({ vendor: 'amd' })).toBe('amd');
    expect(pick({ vendor: 'intel' })).toBe('intel');
    expect(pick({ vendor: 'none' })).toBe('nvidia --cpu');
  });

  it('falls back to the CPU when a release has no build for the card', () => {
    const old = assets.filter((a) => /nvidia\.7z$/.test(a.name));
    expect(pickPortableAsset(old, { vendor: 'amd', name: null, computeCap: null }).cpu).toBe(true);
  });

  it('tells usable cards from plain integrated graphics', () => {
    expect(gpuFromNames(['AMD Radeon RX 7900 XTX']).vendor).toBe('amd');
    expect(gpuFromNames(['AMD Radeon(TM) Graphics']).vendor).toBe('none');
    expect(gpuFromNames(['Intel(R) Arc(TM) A770 Graphics']).vendor).toBe('intel');
    expect(gpuFromNames(['Intel(R) UHD Graphics 770']).vendor).toBe('none');
    expect(gpuFromNames([]).vendor).toBe('none');
  });

  it('upgrades PyTorch within the build that is installed', () => {
    expect(torchIndexFor('2.14.0+cu130')).toBe('https://download.pytorch.org/whl/cu130');
    expect(torchIndexFor('2.8.0+xpu')).toBe('https://download.pytorch.org/whl/xpu');
    expect(torchIndexFor('2.9.0+rocmsdk20250923')).toBeNull();
  });
});

describe('files and settings', () => {
  it('names downloads so Windows accepts them', () => {
    expect(safeFileName('Style: v2?.safetensors')).toBe('Style_ v2_.safetensors');
    expect(safeFileName('NUL.pth')).toBe('_NUL.pth');
    expect(safeFileName('model.safetensors. ')).toBe('model.safetensors');
    expect(safeFileName('a<b>|c*.pt')).toBe('a_b__c_.pt');
  });

  it('rewriting .env keeps settings saved from the web page', () => {
    fs.writeFileSync(
      /** @type {string} */ (process.env.DARKROOM_ENV_FILE),
      'PORT=3001\nCOMFY_DIR=/old\nCOMFY_VRAM_MODE=low\nCIVITAI_AUTO_FETCH=true\nDARKROOM_LOG_LEVEL=debug\n',
    );
    writeEnvFile({ COMFY_DIR: '/new', COMFY_MODE: 'local' });
    const text = fs.readFileSync(/** @type {string} */ (process.env.DARKROOM_ENV_FILE), 'utf8');
    expect(text).toMatch(/^COMFY_DIR=\/new$/m);
    expect(text).toMatch(/^COMFY_VRAM_MODE=low$/m);
    expect(text).toMatch(/^CIVITAI_AUTO_FETCH=true$/m);
    expect(text).toMatch(/^DARKROOM_LOG_LEVEL=debug$/m);
  });

  it.runIf(process.platform !== 'win32')('takes a path dragged from macOS Terminal (escaped spaces)', () => {
    expect(normalizeDraggedPath('/Users/me/My\\ Models/a\\ \\(1\\).safetensors')).toBe('/Users/me/My Models/a (1).safetensors');
  });

  it('linked-model records work without loading the database module into the launcher', () => {
    upsertModelLink({ filename: 'a.safetensors', modelType: 'lora', destPath: path.join(dir, 'm', 'a.safetensors'), sourcePath: path.join(dir, 'ext', 'a.safetensors'), linkType: 'symlink' });
    expect(rebaseModelLinks(path.join(dir, 'm'), path.join(dir, 'n'))).toBe(1);
    expect(listModelLinks()[0].dest_path).toBe(path.join(dir, 'n', 'a.safetensors'));
    // the native module never loaded here (Windows would lock it against npm)
    expect(Object.keys(createRequire(import.meta.url).cache).some((k) => k.includes('better-sqlite3'))).toBe(false);
  });
});
