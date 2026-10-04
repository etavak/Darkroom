import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { directLink, dispositionFilename, downloadErrorMessage, downloadFile, isCivitaiHost, isHuggingFaceHost, resolveModelUrl } from '../lib/download.js';
import { looksLikeApiKey } from '../lib/env.js';

const seen = [];
let site;
let storage;
let base;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));

beforeAll(async () => {
  storage = http.createServer((req, res) => {
    seen.push({ host: 'storage', auth: req.headers.authorization ?? null });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end('weights');
  });
  await new Promise((r) => storage.listen(0, 'localhost', r));
  site = http.createServer((req, res) => {
    seen.push({ host: 'site', auth: req.headers.authorization ?? null });
    if (req.url === '/locked') return res.writeHead(401).end();
    if (req.url === '/same') return res.writeHead(302, { Location: '/file' }).end();
    if (req.url === '/file') return res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end('w');
    if (req.url === '/html') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>');
    if (req.url === '/get?id=7') {
      return res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''4x%20Sharp.pth` }).end('w');
    }
    // promises 1000 bytes, sends one, then the connection drops
    if (req.url === '/short') return res.writeHead(200, { 'Content-Length': '1000' }).write('w', () => res.destroy());
    res.writeHead(307, { Location: `http://localhost:${storage.address().port}/blob` }).end();
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${site.address().port}`;
});
afterAll(() => {
  site.close();
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('downloads', () => {
  it('keeps the key off a redirect to another host (Civitai → storage)', async () => {
    seen.length = 0;
    await downloadFile(`${base}/x`, path.join(dir, 'a'), { headers: { Authorization: 'Bearer KEY' }, quiet: true });
    expect(seen).toEqual([{ host: 'site', auth: 'Bearer KEY' }, { host: 'storage', auth: null }]);
  });
  it('keeps it on a same-host redirect', async () => {
    seen.length = 0;
    await downloadFile(`${base}/same`, path.join(dir, 'b'), { headers: { Authorization: 'Bearer KEY' }, quiet: true });
    expect(seen.every((s) => s.auth === 'Bearer KEY')).toBe(true);
  });
  it('refuses an HTML page instead of a file', async () => {
    await expect(downloadFile(`${base}/html`, path.join(dir, 'c'), { quiet: true })).rejects.toThrow(/web page instead of a model file/);
  });
  it('says why a download needs a key', () => {
    expect(downloadErrorMessage(401, 'civitai.com', false)).toMatch(/^No Civitai API key is saved/);
    expect(downloadErrorMessage(401, 'civitai.com', true)).toMatch(/^Civitai refused your API key/);
    expect(downloadErrorMessage(403, 'huggingface.co', false)).toMatch(/^No Hugging Face token is saved/);
    expect(downloadErrorMessage(500, 'example.com', false)).toBe('Download failed HTTP 500');
  });
  it('a saved link isn\'t used as a key', () => {
    process.env.CIVITAI_TOKEN = 'https://civitai.com/models/1400090/peoples-works-sdxl';
    expect(downloadErrorMessage(401, 'civitai.com', false)).toMatch(/saved Civitai key isn't a valid key/);
    process.env.CIVITAI_TOKEN = '';
  });
  it('recognises key-shaped values', () => {
    expect(looksLikeApiKey('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(looksLikeApiKey('hf_AbCdEfGhIjKlMnOpQrStUv')).toBe(true);
    expect(looksLikeApiKey('https://civitai.com/models/1')).toBe(false);
    expect(looksLikeApiKey('my key')).toBe(false);
  });
});

describe('download sites', () => {
  it('knows the Civitai and Hugging Face sites (and nothing that merely contains the name)', () => {
    for (const h of ['civitai.com', 'civitai.red', 'civitai.green', 'www.civitai.com']) expect(isCivitaiHost(h)).toBe(true);
    for (const h of ['civitai.com.evil.net', 'notcivitai.com', 'civitai.org']) expect(isCivitaiHost(h)).toBe(false);
    expect(isHuggingFaceHost('hf.co')).toBe(true);
    expect(isHuggingFaceHost('hf-mirror.com')).toBe(false); // a third-party mirror never gets the token
  });

  it('turns share links into downloads', () => {
    expect(directLink('https://drive.google.com/file/d/1zAJ-x_9/view?usp=drive_link')).toBe(
      'https://drive.usercontent.google.com/download?id=1zAJ-x_9&export=download&confirm=t',
    );
    expect(directLink('https://drive.google.com/open?id=abc')).toMatch(/download\?id=abc&/);
    expect(directLink('https://www.dropbox.com/scl/fi/x1/m.safetensors?rlkey=k&dl=0')).toBe('https://www.dropbox.com/scl/fi/x1/m.safetensors?rlkey=k&dl=1');
    expect(directLink('https://github.com/a/b/blob/main/models/x.pth')).toBe('https://github.com/a/b/raw/main/models/x.pth');
    expect(directLink('https://example.com/x.safetensors')).toBe('https://example.com/x.safetensors');
  });

  it('reads the file name from Content-Disposition', () => {
    expect(dispositionFilename('attachment; filename="x1_ITF.pth"')).toBe('x1_ITF.pth');
    expect(dispositionFilename("attachment; filename*=UTF-8''my%20model.safetensors")).toBe('my model.safetensors');
    expect(dispositionFilename('attachment; filename="../../evil.pth"')).toBe('evil.pth');
    expect(dispositionFilename(null)).toBeNull();
  });

  it('a link without a file name is named by the server', async () => {
    const meta = await resolveModelUrl(`${base}/get?id=7`);
    expect(meta.filename).toBe('4x Sharp.pth');
    expect(meta.downloadUrl).toBe(`${base}/get?id=7`);
  });

  it('a web page is refused with the list of sites', async () => {
    await expect(resolveModelUrl(`${base}/html`)).rejects.toThrow(/web page.*Civitai/);
    await expect(resolveModelUrl('not a link')).rejects.toThrow(/isn't a link/);
  });

  it('a download cut short is not kept', async () => {
    const dest = path.join(dir, 'short.bin');
    await expect(downloadFile(`${base}/short`, dest, { quiet: true })).rejects.toThrow(/cut off/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.partial`)).toBe(false);
  });
});
