import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { attachComfyWsProxy } from '../src/ws/comfyProxy.js';
import { pendingIds, queuedClients, sockets } from './fakeComfy';

let base = '';
let server: http.Server;
beforeAll(async () => {
  server = http.createServer(createApp());
  attachComfyWsProxy(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const json = (p: string, body?: unknown) =>
  fetch(`http://${base}${p}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

const settings = {
  prompt: 'a cat',
  negative_prompt: '',
  checkpoint: 'model-a.safetensors',
  width: 512,
  height: 512,
  steps: 4,
  cfg: 5,
  sampler: 'euler',
  scheduler: 'normal',
  seed: 1,
  batch_size: 1,
};

describe('live progress (fast GPUs)', () => {
  it('the relay says "ready" only once it is connected to ComfyUI with the page\'s id', async () => {
    const ws = new WebSocket(`ws://${base}/ws?clientId=page-abc-123&preview=1`, { headers: { Host: base } });
    const first = await new Promise<string>((resolve, reject) => {
      ws.on('message', (d) => resolve(d.toString()));
      ws.on('error', reject);
    });
    // The relay's "ready" comes after ComfyUI's socket is open (ComfyUI's own status follows)
    expect(JSON.parse(first)).toEqual({ type: 'darkroom_ready' });
    expect(sockets.has('page-abc-123')).toBe(true);
    ws.close();
  });

  it('the job is queued with the id the page is already listening on', async () => {
    const r = await json('/api/generate', { ...settings, clientId: 'page-abc-123' });
    expect(r.clientId).toBe('page-abc-123');
    expect(queuedClients.at(-1)).toBe('page-abc-123');
  });

  it('an unusable id is replaced', async () => {
    const r = await json('/api/generate', { ...settings, clientId: '../../etc' });
    expect(r.clientId).not.toBe('../../etc');
    expect(queuedClients.at(-1)).toBe(r.clientId);
  });

  it('status says where a quiet job is', async () => {
    const job = await json('/api/generate', { ...settings, clientId: 'page-def-456' });
    expect(await json(`/api/generate/status/${job.jobId}`)).toEqual({ state: 'missing', ahead: 0 });
    pendingIds.push('someone-elses-job', job.promptId);
    expect(await json(`/api/generate/status/${job.jobId}`)).toEqual({ state: 'queued', ahead: 1 });
    pendingIds.length = 0;
  });
});
