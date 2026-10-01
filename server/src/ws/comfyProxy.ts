import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config.js';

type ClientState = {
  previewEnabled: boolean;
};

/**
 * Proxies browser WebSocket connections at /ws?clientId=...&preview=0|1
 * to ComfyUI's /ws?clientId=... so progress and (optionally) binary previews
 * flow through. Each client can unsubscribe from preview frames without
 * affecting other devices.
 */
export function attachComfyWsProxy(server: import('node:http').Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      wss.emit('connection', clientWs, req);
    });
  });

  wss.on('connection', (clientWs: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const clientId = url.searchParams.get('clientId') ?? '';
    const previewParam = url.searchParams.get('preview');
    const state: ClientState = {
      previewEnabled: previewParam !== '0' && previewParam !== 'false',
    };

    const comfyWsUrl = new URL('/ws', config.comfyUrl.replace(/^http/, 'ws'));
    if (clientId) comfyWsUrl.searchParams.set('clientId', clientId);

    const upstream = new WebSocket(comfyWsUrl.toString());

    const closeBoth = () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    };

    upstream.on('open', () => {
      // ready
    });

    upstream.on('message', (data, isBinary) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      // Binary frames are latent JPEG previews — skip when this client unsubscribed.
      if (isBinary && !state.previewEnabled) return;
      clientWs.send(data, { binary: isBinary });
    });

    upstream.on('error', () => {
      closeBoth();
    });

    upstream.on('close', () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });

    clientWs.on('message', (data, isBinary) => {
      // Darkroom control messages (JSON) — do not forward to ComfyUI.
      if (!isBinary) {
        const raw = typeof data === 'string' ? data : data.toString();
        try {
          const msg = JSON.parse(raw) as { type?: string; enabled?: boolean };
          if (msg.type === 'preview_subscribe') {
            state.previewEnabled = Boolean(msg.enabled);
            return;
          }
        } catch {
          // not JSON — forward
        }
      }

      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      }
    });

    clientWs.on('error', () => {
      closeBoth();
    });

    clientWs.on('close', () => {
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    });
  });

  return wss;
}
