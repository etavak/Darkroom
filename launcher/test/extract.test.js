import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sevenBin from '7zip-bin';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describe7zipFailure, extract7z } from '../setup/installComfy.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x7-'));
const archive = path.join(dir, 'portable.7z');

beforeAll(() => {
  // some installs drop the executable bit on the bundled binary
  if (process.platform !== 'win32') fs.chmodSync(sevenBin.path7za, 0o755);
  const src = path.join(dir, 'src', 'ComfyUI_windows_portable', 'python_embeded');
  fs.mkdirSync(src, { recursive: true });
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(src, `file${i}.txt`), `${i} `.repeat(4000));
  const made = spawnSync(sevenBin.path7za, ['a', archive, 'ComfyUI_windows_portable', '-mx=1'], { cwd: path.join(dir, 'src') });
  expect(made.status).toBe(0);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

describe('7-Zip extraction', () => {
  it('unpacks an archive and reports progress', async () => {
    const seen = [];
    const out = path.join(dir, 'ok');
    await extract7z(archive, out, (pct) => seen.push(pct), path.join(dir, '7zip.log'));
    expect(fs.readdirSync(path.join(out, 'ComfyUI_windows_portable', 'python_embeded'))).toHaveLength(40);
    expect(seen.every((p, i) => p >= 0 && p <= 100 && (i === 0 || p !== seen[i - 1]))).toBe(true);
  });

  it('flags a cut-off archive as damaged and says why', async () => {
    const cut = path.join(dir, 'cut.7z');
    const full = fs.readFileSync(archive);
    fs.writeFileSync(cut, full.subarray(0, Math.floor(full.length / 2)));
    const err = await extract7z(cut, path.join(dir, 'cut'), undefined, path.join(dir, '7zip.log')).catch((e) => e);
    expect(fs.readFileSync(path.join(dir, '7zip.log'), 'utf8')).toMatch(/Unexpected end of archive/);
    expect(err).toBeInstanceOf(Error);
    expect(err.damaged).toBe(true);
    expect(err.message).toMatch(/couldn't unpack ComfyUI/);
    expect(err.message).toMatch(/logs\/7zip\.log/);
  });
});

describe('describe7zipFailure', () => {
  it('recognises a file held by antivirus', () => {
    const r = describe7zipFailure(2, 'ERROR: Can not open output file : Access is denied. : C:\\x\\torch_cuda.dll\nSub items Errors: 1');
    expect(r.locked).toBe(true);
    expect(r.damaged).toBe(false);
    expect(r.message).toMatch(/fatal error/);
    expect(r.message).toMatch(/Access is denied/);
    expect(r.message).toMatch(/antivirus/);
  });

  it('recognises a full drive', () => {
    expect(describe7zipFailure(2, 'ERROR: There is not enough space on the disk. : C:\\x\\a.dll').message).toMatch(/drive is full/);
  });

  it('recognises a damaged download', () => {
    const r = describe7zipFailure(2, 'ERROR: Data Error : ComfyUI_windows_portable\\python_embeded\\x.pyd');
    expect(r.damaged).toBe(true);
    expect(r.message).toMatch(/download it fresh/);
  });
});
