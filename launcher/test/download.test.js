import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadErrorMessage, downloadFile } from '../lib/download.js';
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
    await expect(downloadFile(`${base}/html`, path.join(dir, 'c'), { quiet: true })).rejects.toThrow(/HTML instead of a model file/);
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
