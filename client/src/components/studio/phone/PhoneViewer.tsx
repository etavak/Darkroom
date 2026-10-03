import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Columns2, TriangleAlert } from 'lucide-react';
import type { FailedJob } from '../plane/layout';
import type { HistoryThumb } from '../plane/HistoryPanel';

export type ViewerTile = {
  kind: 'record' | 'running' | 'failed';
  src: string | null;
  /** Expected size in pixels (real size once the image loads) */
  w: number;
  h: number;
  progress?: number;
  failed?: FailedJob;
};

type Props = {
  tile: ViewerTile | null;
  compare: { src: string; kind: string } | null;
  compareOn: boolean;
  /** 0–1 while generating */
  progress: number | null;
  toast: { text: string; action?: { label: string; run: () => void } } | null;
  failedActions: { retry: (f: FailedJob) => void; dismiss: (f: FailedJob) => void; copy: (f: FailedJob) => void };
  onLongPress: () => void;
  /** Swipe left (+1, older) / right (−1, newer) */
  onSwipe: (dir: 1 | -1) => void;
  /** A plain tap on the image (opens it full screen) */
  onTap?: () => void;
  /** Shown instead of an image (first run, nothing matches) */
  empty?: ReactNode;
};

const HOLD_MS = 450;

/** The selected image, fitted between the header and the thumbnail strip. */
export function PhoneViewer(p: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 360, h: 400 });
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);
  const [pos, setPos] = useState(50);
  const press = useRef<{ x: number; y: number; t: number; timer: number; held: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const t = p.tile;
  const dims = t && t.src && natural?.src === t.src ? natural : t ? { w: t.w, h: t.h } : null;
  const k = dims ? Math.min(stage.w / dims.w, stage.h / dims.h) : 1;
  const w = dims ? Math.round(dims.w * k) : 0;
  const h = dims ? Math.round(dims.h * k) : 0;

  const down = (e: React.PointerEvent) => {
    if (p.compareOn) return;
    const timer = window.setTimeout(() => {
      if (press.current) {
        press.current.held = true;
        navigator.vibrate?.(10);
        p.onLongPress();
      }
    }, HOLD_MS);
    press.current = { x: e.clientX, y: e.clientY, t: performance.now(), timer, held: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = press.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) window.clearTimeout(d.timer);
  };
  const up = (e: React.PointerEvent) => {
    const d = press.current;
    press.current = null;
    if (!d) return;
    window.clearTimeout(d.timer);
    if (d.held) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - d.t < 700) p.onSwipe(dx < 0 ? 1 : -1);
    else if (Math.hypot(dx, dy) < 10 && performance.now() - d.t < 350) p.onTap?.();
  };
  const cmp = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    setPos(Math.round(Math.min(100, Math.max(0, ((e.clientX - b.left) / b.width) * 100))));
  };

  return (
    <>
      {p.progress !== null ? (
        <div className="absolute left-0 right-0 top-0 z-[2] h-[3px]">
          <div className="h-full" style={{ width: `${p.progress * 100}%`, background: 'var(--s-accent)', boxShadow: '0 0 10px var(--s-accent)', transition: 'width .12s linear' }} />
        </div>
      ) : null}
      <div ref={stageRef} className="st-ph-stage" onContextMenu={(e) => e.preventDefault()}>
        {t ? (
          <div
            className="st-ph-image"
            data-tip=""
            role="img"
            aria-label={t.kind === 'record' ? 'Selected image — tap for full screen, press and hold for actions, swipe for the next' : t.kind === 'running' ? 'Generating' : 'Failed generation'}
            style={{ width: w, height: h }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => {
              if (press.current) window.clearTimeout(press.current.timer);
              press.current = null;
            }}
          >
            {t.src ? (
              <img
                src={t.src}
                alt=""
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (t.kind === 'record' && t.src) setNatural({ src: t.src, w: img.naturalWidth, h: img.naturalHeight });
                }}
              />
            ) : null}
            {t.kind === 'running' ? (
              <span className="st-noise" style={{ backgroundColor: `rgba(40,38,44,${(0.85 * (1 - (t.progress ?? 0))).toFixed(2)})` }} />
            ) : null}
            {t.kind === 'failed' && t.failed ? (
              <div className="st-ph-fail" role="alert">
                <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#f0857f' }}>
                  <TriangleAlert className="h-5 w-5" /> Generation failed
                </span>
                <div className="st-mono max-h-28 overflow-y-auto rounded-lg p-2 text-[11.5px] leading-snug" style={{ background: 'var(--s-ground)' }}>
                  {t.failed.error}
                </div>
                <div className="flex justify-end gap-1.5">
                  <button type="button" className="st-pill" onClick={() => p.failedActions.dismiss(t.failed!)}>Dismiss</button>
                  <button type="button" className="st-pill" onClick={() => p.failedActions.copy(t.failed!)}>Copy</button>
                  <button type="button" className="st-pill st-pill-accent" onClick={() => p.failedActions.retry(t.failed!)}>Retry</button>
                </div>
              </div>
            ) : null}
            {p.compareOn && p.compare && t.kind === 'record' ? (
              <div
                className="st-compare"
                role="slider"
                aria-label="Before and after"
                aria-valuenow={pos}
                style={{ inset: 0 }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  cmp(e);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) cmp(e);
                }}
              >
                <img src={p.compare.src} alt="Before" draggable={false} style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
                <span className="st-compare-line" style={{ left: `${pos}%` }} />
                <span className="st-compare-knob" style={{ left: `${pos}%` }}>
                  <Columns2 className="h-4 w-4" />
                </span>
                <span className="st-compare-tag" style={{ left: 8 }}>Before</span>
                <span className="st-compare-tag" style={{ right: 8 }}>{p.compare.kind}</span>
              </div>
            ) : null}
          </div>
        ) : (
          p.empty ?? null
        )}
      </div>
      {p.toast ? (
        <div className="st-toast" role="status" style={{ top: 12, bottom: 'auto', zIndex: 5 }}>
          <span className="pr-2">{p.toast.text}</span>
          {p.toast.action ? (
            <button type="button" className="st-pill h-[26px]" style={{ color: 'var(--s-accent)' }} onClick={p.toast.action.run}>
              {p.toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** Horizontal thumbnails, newest first; tap to show, press and hold for actions. */
export function PhoneThumbs({ thumbs, selectedId, onPick, onLongPress, isPinned }: { thumbs: HistoryThumb[]; selectedId: string | null; onPick: (t: HistoryThumb) => void; onLongPress: (t: HistoryThumb) => void; isPinned: (id: string) => boolean }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; timer: number; held: boolean } | null>(null);

  // Keep the selected thumbnail in view
  useLayoutEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('.st-ph-thumb.on');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  if (!thumbs.length) return null;
  return (
    <div ref={stripRef} className="st-ph-thumbs" aria-label="History">
      {thumbs.map((t) => {
        const e = t.entry;
        const rid = e.kind === 'record' ? e.record.id : null;
        return (
          <button
            key={t.id}
            type="button"
            data-tip=""
            className={`st-ph-thumb ${t.id === selectedId ? 'on' : ''}`}
            aria-label={e.kind === 'failed' ? 'Failed generation' : e.kind === 'running' ? 'Generating' : 'Show image'}
            onPointerDown={(ev) => {
              const timer = window.setTimeout(() => {
                if (press.current && rid) {
                  press.current.held = true;
                  navigator.vibrate?.(10);
                  onLongPress(t);
                }
              }, HOLD_MS);
              press.current = { x: ev.clientX, timer, held: false };
            }}
            onPointerMove={(ev) => {
              if (press.current && Math.abs(ev.clientX - press.current.x) > 8) window.clearTimeout(press.current.timer);
            }}
            onPointerUp={() => press.current && window.clearTimeout(press.current.timer)}
            onPointerCancel={() => press.current && window.clearTimeout(press.current.timer)}
            onClick={() => {
              const held = press.current?.held;
              press.current = null;
              if (!held) onPick(t);
            }}
            onContextMenu={(ev) => ev.preventDefault()}
          >
            {t.src ? <img src={t.src} alt="" draggable={false} loading="lazy" /> : null}
            {e.kind === 'running' ? <span className="st-noise" style={{ backgroundColor: 'rgba(40,38,44,.6)' }} /> : null}
            {e.kind === 'failed' ? <span className="st-noise" style={{ backgroundColor: 'rgba(120,40,36,.6)' }} /> : null}
            {rid && isPinned(rid) ? (
              <svg viewBox="0 0 24 24" width="13" height="13" className="absolute right-1 top-1" fill="var(--s-accent)" stroke="rgba(0,0,0,.5)" strokeWidth={1} aria-hidden>
                <path d="M15 3 21 9l-3 1-4 4 .5 4.5L13 20l-4-4-5 5-1-1 5-5-4-4 1.5-1.5L10 10l4-4z" />
              </svg>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
