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
    res.end(
      JSON.stringify({
        system: { comfyui_version: 'mock' },
        devices: [
          {
            name: 'mps',
            type: 'mps',
            vram_total: 36 * 1024 ** 3,
            vram_free: 24 * 1024 ** 3,
          },
        ],
      }),
    );
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
        UNETLoader: {
          input: {
            required: {
              unet_name: [['mock_flux_unet.safetensors']],
              weight_dtype: [['default', 'fp8_e4m3fn']],
            },
          },
        },
        DualCLIPLoader: {
          input: {
            required: {
              clip_name1: [['clip_l.safetensors', 't5xxl_fp16.safetensors']],
              clip_name2: [['clip_l.safetensors', 't5xxl_fp16.safetensors']],
              type: [['flux', 'sdxl', 'sd3']],
            },
          },
        },
        CLIPLoader: {
          input: {
            required: {
              clip_name: [['clip_l.safetensors']],
              type: [['stable_diffusion', 'flux']],
            },
          },
        },
        VAELoader: {
          input: {
            required: {
              vae_name: [['ae.safetensors', 'mock_vae.safetensors']],
            },
          },
        },
        LoraLoader: {
          input: {
            required: {
              lora_name: [['mock_lora.safetensors']],
            },
          },
        },
        ControlNetLoader: {
          input: {
            required: {
              control_net_name: [['mock_controlnet.safetensors']],
            },
          },
        },
        ControlNetApplyAdvanced: { input: { required: {} } },
        AIO_Preprocessor: { input: { required: {} } },
        CannyEdgePreprocessor: { input: { required: {} } },
        FaceDetailer: { input: { required: {} } },
        UltralyticsDetectorProvider: {
          input: {
            required: {
              model_name: [['bbox/face_yolov8m.pt']],
            },
          },
        },
        UpscaleModelLoader: {
          input: {
            required: {
              model_name: [['4x_mock.pth']],
            },
          },
        },
        LoadImage: { input: { required: { image: [['mock_source.png']] } } },
        ImageScale: { input: { required: {} } },
        ImagePadForOutpaint: { input: { required: {} } },
        VAEEncode: { input: { required: {} } },
        VAEDecode: { input: { required: {} } },
        SetLatentNoiseMask: { input: { required: {} } },
        KSampler: { input: { required: {} } },
        EmptyLatentImage: { input: { required: {} } },
        ReferenceLatent: { input: { required: {} } },
        FluxGuidance: { input: { required: {} } },
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

  if (url.pathname === '/upload/image') {
    // Consume body; return a stable filename for LoadImage
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'mock_source.png', subfolder: '', type: 'input' }));
    });
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
