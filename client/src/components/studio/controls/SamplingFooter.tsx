import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Lock, Shuffle, Square, TriangleAlert, X } from 'lucide-react';
import type { QueuedJob } from '@/components/controls/JobQueue';

type Props = {
  steps: number;
  cfgLabel: string;
  cfgValue: number | string;
  seedLocked: boolean;
  seed: number;
  onToggleSeedLock: () => void;
  sampler: string;
  /** Full controls shown when the row is expanded (sampler/scheduler/steps/CFG/seed…) */
  expanded: ReactNode;

  generateLabel: string;
  onGenerate: () => void;
  generateDisabled: boolean;
  disabledReason?: string | null;
  running: boolean;
  progressStep: number;
  progressMax: number;
  onStop: () => void;
  queue: QueuedJob[];
  activeQueueId: string | null;
  onRemoveJob: (id: string) => void;
  onClearQueue: () => void;
  error?: string | null;
  notice?: string | null;
  /** ComfyUI unreachable: just dropped (reconnecting) or not running (offline) */
  connection?: {
    /** server = the Darkroom server isn't answering (ComfyUI may be fine) */
    kind: 'offline' | 'reconnecting' | 'starting' | 'server';
    remote: boolean;
    retrying: boolean;
    onRetry: () => void;
    starting: boolean;
    onStart: () => void;
  } | null;
};

/**
 * Pinned footer of the controls column: the everyday sampling values on one row (the
 * chevron expands the full controls in place), then Generate with Stop and the queue.
 */
export function SamplingFooter(p: Props) {
  const [open, setOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const waiting = p.queue.filter((j) => j.id !== p.activeQueueId);
  const current = p.queue.find((j) => j.id === p.activeQueueId) ?? null;
  const busy = p.running || p.queue.length > 0;
  const pct = p.progressMax ? Math.round((p.progressStep / p.progressMax) * 100) : 0;

  return (
    <div className="relative flex flex-col gap-2.5 px-3.5 pb-3.5 pt-3" style={{ borderTop: '1px solid var(--s-line)', background: 'var(--s-ground)' }}>
      {p.connection ? (
        <div
          className="st-conn"
          role="alert"
          style={
            p.connection.kind === 'offline' || p.connection.kind === 'server'
              ? { background: 'rgba(229,83,75,.08)', border: '1px solid rgba(229,83,75,.4)' }
              : { background: 'rgba(226,180,79,.08)', border: '1px solid rgba(226,180,79,.4)' }
          }
        >
          <TriangleAlert className="mt-px h-5 w-5 shrink-0" style={{ color: p.connection.kind === 'offline' || p.connection.kind === 'server' ? '#e5534b' : '#e2b44f' }} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold">
              {p.connection.kind === 'server'
                ? 'Can’t reach Darkroom'
                : p.connection.kind === 'starting'
                  ? 'Starting ComfyUI…'
                  : p.connection.kind === 'offline'
                    ? 'ComfyUI isn’t running'
                    : 'Reconnecting to ComfyUI…'}
            </span>
            <span className="text-[12.5px] leading-snug" style={{ color: 'var(--s-muted)' }}>
              {p.connection.kind === 'server'
                ? 'The Darkroom server isn’t answering — it may be restarting. This page reconnects on its own.'
                : p.connection.kind === 'starting'
                  ? 'Loading models can take a minute the first time. Generate unlocks when it’s ready.'
                  : p.connection.kind === 'reconnecting'
                ? 'The connection dropped. Darkroom keeps retrying on its own.'
                : p.connection.remote
                  ? 'Start ComfyUI on the remote computer. Your images stay browsable meanwhile.'
                  : 'Start it here or from the Darkroom launcher. Your images stay browsable meanwhile.'}
            </span>
            <span className="flex gap-1.5 pt-1.5">
              {(p.connection.kind === 'offline' || p.connection.kind === 'starting') && !p.connection.remote ? (
                <button type="button" className="st-pill st-pill-accent h-7 text-xs" disabled={p.connection.starting} onClick={p.connection.onStart} data-tip="Start the local ComfyUI">
                  {p.connection.starting ? 'Starting…' : 'Start ComfyUI'}
                </button>
              ) : null}
              <button type="button" className="st-pill h-7 text-xs" disabled={p.connection.retrying} onClick={p.connection.onRetry} data-tip="Try to reach ComfyUI again">
                {p.connection.retrying ? 'Trying…' : 'Retry'}
              </button>
            </span>
          </div>
        </div>
      ) : null}
      {open ? (
        <div className="st-card">
          <div className="flex items-center justify-between py-1 pl-3.5 pr-1.5">
            <span className="text-sm font-semibold">Sampling</span>
            <button type="button" className="st-ibtn" onClick={() => setOpen(false)} aria-label="Collapse sampling settings" aria-expanded data-tip="Collapse">
              <ChevronDown />
            </button>
          </div>
          <div className="st-scroll flex max-h-[46vh] flex-col gap-3 px-3.5 pb-3.5">{p.expanded}</div>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 rounded-xl p-1" style={{ background: 'var(--s-panel)', border: '1px solid var(--s-line)' }}>
          <button type="button" className="st-param" onClick={() => setOpen(true)} data-tip="Sampling steps — more is slower, usually finer">
            <span className="st-lbl">Steps</span>
            <span className="st-mono text-base font-semibold">{p.steps}</span>
          </button>
          <button type="button" className="st-param" onClick={() => setOpen(true)} data-tip={`${p.cfgLabel} — how strictly the prompt is followed`}>
            <span className="st-lbl">{p.cfgLabel}</span>
            <span className="st-mono text-base font-semibold">{p.cfgValue}</span>
          </button>
          <button
            type="button"
            className="st-param"
            onClick={p.onToggleSeedLock}
            aria-pressed={p.seedLocked}
            data-tip={p.seedLocked ? `Seed locked at ${p.seed} — click for a new seed each time` : 'Random seed each image — click to lock the current one'}
          >
            <span className="st-lbl">Seed</span>
            <span className="inline-flex h-[22px] items-center">
              {p.seedLocked ? <Lock className="h-[18px] w-[18px]" style={{ color: 'var(--s-accent)' }} /> : <Shuffle className="h-[18px] w-[18px]" />}
            </span>
          </button>
          <button type="button" className="st-param min-w-0 flex-1" onClick={() => setOpen(true)} data-tip="Sampler — how noise is removed each step">
            <span className="st-lbl">Sampler</span>
            <span className="max-w-full truncate text-[15px] font-semibold">{p.sampler}</span>
          </button>
          <button type="button" className="st-ibtn" onClick={() => setOpen(true)} aria-label="All sampling settings" aria-expanded={false} data-tip="All sampling settings">
            <ChevronUp />
          </button>
        </div>
      )}

      {busy ? (
        <div className="relative flex items-center justify-between gap-2 px-0.5">
          <span className="st-mono text-[12.5px]" style={{ color: 'var(--s-muted)' }}>
            {p.running ? (p.progressMax ? `Step ${p.progressStep} / ${p.progressMax} · ${pct}%` : 'Starting…') : 'Waiting…'}
          </span>
          <button type="button" className="st-pill" onClick={() => setQueueOpen((o) => !o)} aria-expanded={queueOpen} data-tip="See and manage the queue">
            {waiting.length ? `${waiting.length} queued` : 'Queue'}
            {queueOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
          {queueOpen ? (
            <div className="st-menu" data-tip-avoid style={{ bottom: 'calc(100% + 10px)', left: -2, right: -2, padding: 8 }} role="dialog" aria-label="Queue">
              {current ? (
                <>
                  <div className="st-sec px-2 py-1">Now</div>
                  <div className="flex items-center gap-2.5 rounded-lg p-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-[13px]">{current.label}</span>
                      <span className="h-[3px] overflow-hidden rounded-sm" style={{ background: 'var(--s-raised2)' }}>
                        <span className="block h-full" style={{ width: `${pct}%`, background: 'var(--s-accent)' }} />
                      </span>
                    </div>
                    <button type="button" className="st-ibtn h-[34px] w-[34px]" style={{ color: '#f0857f' }} onClick={p.onStop} aria-label="Stop current image" data-tip="Stop — the next job starts">
                      <Square className="h-4 w-4" fill="currentColor" />
                    </button>
                  </div>
                </>
              ) : null}
              <div className="flex items-center justify-between px-2 pb-1 pt-2">
                <span className="st-sec">Up next</span>
                <button type="button" className="st-pill h-[26px] text-xs" disabled={!waiting.length} onClick={p.onClearQueue} data-tip="Remove every waiting job">
                  Clear
                </button>
              </div>
              {waiting.length === 0 ? (
                <p className="m-0 px-2 pb-2 pt-1.5 text-[13px]" style={{ color: 'var(--s-muted)' }}>Nothing waiting. Press Generate again to queue more.</p>
              ) : (
                waiting.map((j, i) => (
                  <div key={j.id} className="flex items-center gap-2.5 rounded-lg p-2">
                    <span className="st-mono w-[18px] text-right text-[11.5px]" style={{ color: 'var(--s-faint)' }}>{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{j.label}</span>
                    <button type="button" className="st-ibtn h-[34px] w-[34px]" onClick={() => p.onRemoveJob(j.id)} aria-label="Remove from queue" data-tip="Remove from queue">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          className="st-gen min-w-0 flex-1"
          onClick={p.onGenerate}
          disabled={p.generateDisabled}
          data-tip={p.generateDisabled ? p.disabledReason || 'Not ready' : p.running ? 'Adds to the queue' : 'Generate  ·  Ctrl ↵'}
        >
          <span className="truncate">{p.generateLabel}</span>
          <span className="st-mono inline-flex h-8 shrink-0 items-center rounded-lg px-2.5 text-[12.5px] font-medium" style={{ background: 'var(--s-accent-ink)', color: 'var(--s-accent)' }}>
            Ctrl ↵
          </span>
        </button>
        {p.running ? (
          <button type="button" className="st-stop" onClick={p.onStop} aria-label="Stop the current image" data-tip="Stop the current image — queued jobs continue">
            <Square className="h-[18px] w-[18px]" fill="currentColor" />
          </button>
        ) : null}
      </div>
      {p.generateDisabled && p.disabledReason ? (
        <p className="m-0 text-center text-[11.5px]" style={{ color: 'var(--s-muted)' }}>{p.disabledReason}</p>
      ) : null}
      {p.error ? <p className="m-0 text-xs" style={{ color: '#f0857f' }}>{p.error}</p> : null}
      {p.notice ? <p className="m-0 text-center text-[11.5px]" style={{ color: 'var(--s-muted)' }}>{p.notice}</p> : null}
    </div>
  );
}
