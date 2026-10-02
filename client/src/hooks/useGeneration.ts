import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelGenerate, fetchHistoryItem, startGenerate } from '../lib/api';
import { ComfyWsClient } from '../lib/ws';
import type { GenerationRecord, GenerationSettings } from '../types/generation';

export type GenerationRuntime = {
  running: boolean;
  progress: number;
  progressStep: number;
  progressMax: number;
  previewUrl: string | null;
  resultImages: string[];
  error: string | null;
  promptId: string | null;
  jobId: string | null;
};

const initialRuntime: GenerationRuntime = {
  running: false,
  progress: 0,
  progressStep: 0,
  progressMax: 0,
  previewUrl: null,
  resultImages: [],
  error: null,
  promptId: null,
  jobId: null,
};

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

export type GenerateOptions = {
  livePreview?: boolean;
  previewMethod?: 'latent2rgb' | 'taesd';
};

export function useGeneration(onComplete?: (record: GenerationRecord) => void) {
  const [runtime, setRuntime] = useState<GenerationRuntime>(initialRuntime);
  const wsRef = useRef<ComfyWsClient | null>(null);
  const previewObjectUrl = useRef<string | null>(null);
  const activePromptId = useRef<string | null>(null);
  const activeJobId = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const livePreviewRef = useRef(true);
  const inFlightRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const revokePreview = () => {
    if (previewObjectUrl.current) {
      URL.revokeObjectURL(previewObjectUrl.current);
      previewObjectUrl.current = null;
    }
  };

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      revokePreview();
    };
  }, []);

  /** Sync live-preview preference to an active WS (and clear local preview when off). */
  const setLivePreviewEnabled = useCallback((enabled: boolean) => {
    livePreviewRef.current = enabled;
    wsRef.current?.setPreviewEnabled(enabled);
    if (!enabled) {
      revokePreview();
      setRuntime((r) => (r.previewUrl ? { ...r, previewUrl: null } : r));
    }
  }, []);

  const cancel = useCallback(async () => {
    cancelledRef.current = true;
    const jobId = activeJobId.current;
    try {
      await cancelGenerate(jobId);
    } catch {
      // still stop local polling
    }
    wsRef.current?.close();
    revokePreview();
    setRuntime((r) => ({
      ...r,
      running: false,
      previewUrl: null,
      error: null,
    }));
  }, []);

  const generate = useCallback(async (settings: GenerationSettings, opts?: GenerateOptions) => {
    if (inFlightRef.current) {
      throw new Error('A generation is already running');
    }
    inFlightRef.current = true;
    cancelledRef.current = false;
    const livePreview = opts?.livePreview !== false;
    livePreviewRef.current = livePreview;

    setRuntime({
      ...initialRuntime,
      running: true,
      resultImages: [],
    });
    revokePreview();

    try {
      const { jobId, promptId, clientId } = await startGenerate({
        ...settings,
        ...(opts?.previewMethod ? { previewMethod: opts.previewMethod } : {}),
      });
      if (cancelledRef.current) {
        // Cancel was pressed before we had a job id — drop the prompt we just queued
        void cancelGenerate(jobId).catch(() => {});
        throw new CancelledError();
      }

      activePromptId.current = promptId;
      activeJobId.current = jobId;

      const client = new ComfyWsClient();
      wsRef.current?.close();
      wsRef.current = client;
      client.connect(clientId, { preview: livePreview });

      client.onEvent((event) => {
        if (cancelledRef.current) return;
        if (event.type === 'progress') {
          if (event.promptId && event.promptId !== activePromptId.current) return;
          const pct = event.max > 0 ? (event.value / event.max) * 100 : 0;
          setRuntime((r) => ({
            ...r,
            progress: pct,
            progressStep: event.value,
            progressMax: event.max,
          }));
        } else if (event.type === 'preview') {
          if (!livePreviewRef.current) return;
          revokePreview();
          const url = URL.createObjectURL(event.blob);
          previewObjectUrl.current = url;
          setRuntime((r) => ({ ...r, previewUrl: url }));
        }
      });

      setRuntime((r) => ({
        ...r,
        jobId,
        promptId,
      }));

      const record = await pollJob(jobId, () => cancelledRef.current);
      if (cancelledRef.current) throw new CancelledError();

      setRuntime((r) => ({
        ...r,
        running: false,
        progress: 100,
        resultImages: record.images,
        previewUrl: null,
      }));
      revokePreview();
      wsRef.current?.close();
      onCompleteRef.current?.(record);
      return record;
    } catch (err) {
      if (err instanceof CancelledError || cancelledRef.current) {
        setRuntime((r) => ({
          ...r,
          running: false,
          previewUrl: null,
          error: null,
        }));
        return null;
      }
      const message = err instanceof Error ? err.message : 'Generation failed';
      setRuntime((r) => ({
        ...r,
        running: false,
        error: message,
      }));
      wsRef.current?.close();
      throw err;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  return { runtime, generate, cancel, setLivePreviewEnabled };
}

/**
 * Poll the history record until the server marks it completed or failed.
 * No wall-clock cap — the server watcher decides when a job is lost.
 */
async function pollJob(
  jobId: string,
  isCancelled: () => boolean,
  maxConsecutiveErrors = 60,
): Promise<GenerationRecord> {
  let errors = 0;
  for (;;) {
    if (isCancelled()) throw new CancelledError();
    try {
      const item = await fetchHistoryItem(jobId);
      errors = 0;
      if (item.status === 'completed' && item.images.length > 0) return item;
      if (item.status === 'failed') {
        if (item.error === 'Cancelled') throw new CancelledError();
        throw new Error(item.error ?? 'Generation failed');
      }
    } catch (err) {
      // fetch() rejects with TypeError on network failure (server restarting) — retry.
      // Anything else is a real outcome (failed / cancelled / error response).
      if (!(err instanceof TypeError)) throw err;
      if (++errors >= maxConsecutiveErrors) {
        throw new Error('Lost connection to the Darkroom server');
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
