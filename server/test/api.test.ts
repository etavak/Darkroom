import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let base = '';
let server: http.Server;
beforeAll(async () => {
  server = http.createServer(createApp());
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const get = (p: string, headers: Record<string, string> = {}) => fetch(base + p, { headers });
const send = (method: string, p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('HTTP app', () => {
  it('health reports ComfyUI', async () => {
    const r = await (await get('/api/health')).json();
    expect(r).toMatchObject({ ok: true, comfy: true });
  });
  it('blocks other host names (DNS rebinding)', async () => {
    const r = await new Promise<number>((resolve) => {
      const u = new URL(base);
      http.get({ host: u.hostname, port: u.port, path: '/api/health', headers: { Host: 'evil.example' } }, (res) => resolve(res.statusCode ?? 0)).end();
    });
    expect(r).toBe(403);
  });
  it('blocks cross-site writes', async () => {
    const r = await send('POST', '/api/history/downloaded', { images: [] }, { Origin: 'http://evil.example' });
    expect(r.status).toBe(403);
  });
  it('model list includes upscalers (newer COMBO format)', async () => {
    const r = await (await get('/api/models')).json();
    expect(r.upscale_models.length).toBeGreaterThan(0);
  });
  it('history is paged', async () => {
    const r = await (await get('/api/history?limit=5')).json();
    expect(r).toHaveProperty('items');
    expect(r).toHaveProperty('hasMore');
    expect(r).toHaveProperty('total');
  });
  it('download keys: links are refused, real keys are saved write-only (to the temp .env)', async () => {
    const bad = await send('PUT', '/api/settings/tokens', { civitai: 'https://civitai.com/models/1' });
    expect(bad.status).toBe(400);
    const ok = await (await send('PUT', '/api/settings/tokens', { civitai: '0123456789abcdef0123456789abcdef' })).json();
    expect(ok).toMatchObject({ civitai: true, civitaiInvalid: false });
    expect(fs.readFileSync(process.env.DARKROOM_ENV_FILE!, 'utf8')).toMatch(/CIVITAI_TOKEN=0123/);
    const flags = await (await get('/api/settings/tokens')).json();
    expect(JSON.stringify(flags)).not.toMatch(/0123456789/);
  });
  it('the purge refuses without its confirmation', async () => {
    const r = await send('POST', '/api/history/unsaved/purge', { keep: [] });
    expect(r.status).toBe(400);
  });
  it('enhance test explains a missing URL', async () => {
    const r = await (await send('POST', '/api/prompt/enhance/test', {})).json();
    expect(r).toMatchObject({ ok: false });
  });
  it('the face model install refuses nothing silently: ControlNet options list for a family', async () => {
    const r = await (await get('/api/models/controlnet/options?family=illustrious')).json();
    expect(r.arch).toBe('sdxl');
    expect(r.items.map((i: { id: string }) => i.id)).toContain('cn_sdxl_union_promax');
  });
});
