export type ProgressEvent = {
  type: 'progress';
  value: number;
  max: number;
  promptId?: string;
};

export type StatusEvent = {
  type: 'status';
  execInfo?: { queue_remaining?: number };
};

export type ExecutingEvent = {
  type: 'executing';
  node: string | null;
  promptId?: string;
};

export type ExecutedEvent = {
  type: 'executed';
  promptId?: string;
};

export type PreviewEvent = {
  type: 'preview';
  blob: Blob;
};

/** Any ComfyUI message about a prompt (start, cached, node finished…) — proof it's moving. */
export type ActivityEvent = {
  type: 'activity';
  promptId?: string;
};

export type WsEvent = ProgressEvent | StatusEvent | ExecutingEvent | ExecutedEvent | PreviewEvent | ActivityEvent;

type Listener = (event: WsEvent) => void;

/**
 * Connects to the server WS proxy for a given Comfy client_id.
 * Text frames are JSON Comfy messages; binary frames are JPEG previews
 * (first 8 bytes are a type header from ComfyUI).
 *
 * Pass preview=false so the backend does not relay binary preview frames
 * (progress / status still flow). Toggle mid-session with setPreviewEnabled.
 */
export class ComfyWsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();

  /**
   * Opens the socket; resolves once Darkroom's relay is connected to ComfyUI (or after
   * `waitMs` / on failure — the job then still runs, just possibly without progress).
   * Queue the job only after this, so a fast GPU can't start it before anyone listens.
   */
  connect(clientId: string, opts?: { preview?: boolean; waitMs?: number }): Promise<void> {
    this.close();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const preview = opts?.preview !== false;
    const url = `${proto}//${window.location.host}/ws?clientId=${encodeURIComponent(clientId)}&preview=${preview ? '1' : '0'}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    return new Promise<void>((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(done, opts?.waitMs ?? 3000);
      ws.onerror = done;
      ws.onclose = done;
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          if (ev.data.includes('"darkroom_ready"')) {
            done();
            return;
          }
          this.handleText(ev.data);
          return;
        }
        this.handleBinary(ev.data as ArrayBuffer);
      };
    });
  }

  /** Ask the Darkroom proxy to start/stop relaying preview frames. */
  setPreviewEnabled(enabled: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'preview_subscribe', enabled }));
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private emit(event: WsEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private handleText(raw: string) {
    try {
      const msg = JSON.parse(raw) as {
        type: string;
        data?: Record<string, unknown>;
      };
      const data = msg.data ?? {};

      if (typeof data.prompt_id === 'string') this.emit({ type: 'activity', promptId: data.prompt_id });

      if (msg.type === 'progress') {
        this.emit({
          type: 'progress',
          value: Number(data.value ?? 0),
          max: Number(data.max ?? 1),
          promptId: data.prompt_id as string | undefined,
        });
      } else if (msg.type === 'status') {
        const status = data.status as { exec_info?: { queue_remaining?: number } } | undefined;
        this.emit({
          type: 'status',
          execInfo: status?.exec_info,
        });
      } else if (msg.type === 'executing') {
        this.emit({
          type: 'executing',
          node: (data.node as string | null) ?? null,
          promptId: data.prompt_id as string | undefined,
        });
      } else if (msg.type === 'executed') {
        this.emit({
          type: 'executed',
          promptId: data.prompt_id as string | undefined,
        });
      }
    } catch {
      // ignore malformed
    }
  }

  private handleBinary(buffer: ArrayBuffer) {
    // ComfyUI: first 8 bytes = event type (int) + image format (int); rest is image bytes
    if (buffer.byteLength <= 8) return;
    const imageBytes = buffer.slice(8);
    const blob = new Blob([imageBytes], { type: 'image/jpeg' });
    this.emit({ type: 'preview', blob });
  }
}
