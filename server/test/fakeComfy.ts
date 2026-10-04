import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import objectInfo from './fixtures/object_info.json';

/** What the fake ComfyUI was asked to run. */
export const queued: Array<Record<string, { class_type: string; inputs: Record<string, unknown> }>> = [];
/** client_id of each queued prompt, and prompt ids the fake reports as waiting */
export const queuedClients: string[] = [];
export const pendingIds: string[] = [];
/** client ids with an open websocket */
export const sockets = new Set<string>();
/** When on, the fake accepts connections but never answers — a frozen ComfyUI */
export const frozen = { on: false };

/**
 * A ComfyUI stand-in for tests: serves the recorded object_info, accepts /prompt (rejecting
 * unknown nodes the way ComfyUI does) and answers the health / stats endpoints.
 */
export async function startFakeComfy(): Promise<{ url: string; close: () => Promise<void> }> {
  const info = objectInfo as Record<string, unknown>;
  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? '/', 'http://x');
    if (frozen.on) return;
    if (req.method === 'GET' && url.pathname === '/object_info') return send(200, info);
    if (req.method === 'GET' && url.pathname.startsWith('/object_info/')) {
      const name = decodeURIComponent(url.pathname.slice('/object_info/'.length));
      return send(200, info[name] ? { [name]: info[name] } : {});
    }
    if (req.method === 'GET' && url.pathname === '/system_stats') return send(200, { system: { os: 'test' }, devices: [] });
    if (req.method === 'GET' && url.pathname === '/queue') return send(200, { queue_running: [], queue_pending: pendingIds.map((id, i) => [i + 1, id, {}, {}, []]) });
    if (req.method === 'POST' && url.pathname === '/prompt') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body) as { prompt: (typeof queued)[number]; client_id: string };
        const prompt = parsed.prompt;
        const unknown = Object.entries(prompt).find(([, n]) => !info[n.class_type]);
        if (unknown) {
          return send(400, {
            error: { type: 'missing_node_type', message: `Node '${unknown[1].class_type}' not found.`, extra_info: { node_id: unknown[0], class_type: unknown[1].class_type } },
            node_errors: {},
          });
        }
        queued.push(prompt);
        queuedClients.push(parsed.client_id);
        send(200, { prompt_id: `p${queued.length}`, number: queued.length });
      });
      return;
    }
    send(404, { error: 'not found' });
  });
  // ComfyUI's /ws?clientId=… (progress goes only to the socket with the prompt's client id)
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const id = new URL(req.url ?? '/', 'http://x').searchParams.get('clientId') ?? '';
    sockets.add(id);
    ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: id } }));
    ws.on('close', () => sockets.delete(id));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((r) => {
        wss.close();
        server.close(() => r());
        server.closeAllConnections(); // requests left hanging by the frozen mode
      }),
  };
}
