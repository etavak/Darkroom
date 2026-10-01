/**
 * Minimal ComfyUI mock for local smoke tests.
 * Requires MOCK=true in the environment — refuses to start otherwise.
 *
 *   MOCK=true npm run mock:comfy
 */
import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

if (process.env.MOCK !== 'true') {
  console.error('Refusing to start mock ComfyUI. Set MOCK=true to enable.');
  process.exit(1);
}

const PORT = 8188;
const jobs = new Map<string, { clientId: string; done: boolean }>();
const clients = new Map<string, WebSocket>();

function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function broadcast(clientId: string, msg: unknown) {
  const ws = clients.get(clientId);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/system_stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ system: { comfyui_version: 'mock' } }));
    return;
  }

  if (url.pathname === '/object_info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        CheckpointLoaderSimple: {
          input: {
            required: {
              ckpt_name: [['mock_sdxl.safetensors', 'other_model.safetensors']],
            },
          },
        },
      }),
    );
    return;
  }

  if (url.pathname === '/interrupt' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'interrupted' }));
    return;
  }

  if (url.pathname === '/prompt' && req.method === 'POST') {
    const body = await readBody(req);
    const parsed = JSON.parse(body) as { client_id?: string };
    const promptId = `mock-${Date.now()}`;
    jobs.set(promptId, { clientId: parsed.client_id ?? '', done: false });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ prompt_id: promptId, number: 1 }));

    setTimeout(() => {
      const job = jobs.get(promptId);
      if (!job) return;
      broadcast(job.clientId, {
        type: 'progress',
        data: { value: 5, max: 10, prompt_id: promptId },
      });
      broadcast(job.clientId, {
        type: 'progress',
        data: { value: 10, max: 10, prompt_id: promptId },
      });
      broadcast(job.clientId, {
        type: 'executing',
        data: { node: null, prompt_id: promptId },
      });
      job.done = true;
    }, 400);
    return;
  }

  if (url.pathname.startsWith('/history/')) {
    const promptId = url.pathname.replace('/history/', '');
    const job = jobs.get(promptId);
    if (!job || !job.done) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        [promptId]: {
          status: { completed: true, status_str: 'success' },
          outputs: {
            '9': {
              images: [{ filename: 'mock.png', subfolder: '', type: 'output' }],
            },
          },
        },
      }),
    );
    return;
  }

  if (url.pathname === '/view') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(tinyPng());
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const clientId = url.searchParams.get('clientId') ?? '';
    if (clientId) clients.set(clientId, ws);
    ws.on('close', () => {
      if (clientId) clients.delete(clientId);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock ComfyUI on http://127.0.0.1:${PORT} (MOCK=true)`);
});
