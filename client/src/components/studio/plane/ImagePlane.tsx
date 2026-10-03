import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Columns2, TriangleAlert } from 'lucide-react';
import {
  CompareIcon,
  CopyIcon,
  CopyImageIcon,
  DownloadIcon,
  EditIcon,
  EnhanceIcon,
  InpaintIcon,
  PinIcon,
  SeedIcon,
  UpscaleIcon,
  UseAsBaseIcon,
  VaryIcon,
} from './icons';
import type { CanvasBackground } from '@/lib/uiSettings';
import { WORLD_SCALE, fitZoom, layoutTiles, ratioLabel, tileId, type FailedJob, type PlaneEntry, type Tile } from './layout';

/** run(alt): alt is true for Shift-click (e.g. a stronger variation) */
export type PlaneAction = { run: (alt?: boolean) => void; disabled?: boolean; tip: string };

type Props = {
  entries: PlaneEntry[];
  /** Selected tile id (`key:index`) */
  selectedId: string | null;
  onSelect: (tile: Tile) => void;
  /** Bumped by the app when the selection should be brought into view */
  focus: { id: string; n: number } | null;
  onContext: (tile: Tile, x: number, y: number) => void;
  actions: {
    enhance: PlaneAction;
    vary: PlaneAction;
    upscale: PlaneAction;
    useAsBase: PlaneAction;
    edit: PlaneAction;
    inpaint: PlaneAction;
  };
  /** Bottom bar for the selected finished image */
  info: {
    seed: number | null;
    pinned: boolean;
    onPin: () => void;
    onCopyImage: () => void;
    onDownload: () => void;
    onCopySeed: () => void;
  } | null;
  /** Original of the selected image, for the before/after slider */
  compare: { src: string; kind: string } | null;
  failedActions: { retry: (f: FailedJob) => void; dismiss: (f: FailedJob) => void; copy: (f: FailedJob) => void };
  /** 0–1 while generating */
  progress: number | null;
  toast: { text: string; action?: { label: string; run: () => void } } | null;
  background: CanvasBackground;
  /** Centred content when there's nothing to show (empty / offline / no model) */
  overlay?: ReactNode;
  /** A file dropped on the plane (Darkroom PNG → reuse its settings) */
  onDropFile?: (file: File) => void;
};

type View = { x: number; y: number; z: number };

const EASE = 'cubic-bezier(.2,.8,.2,1)';

function Float({ children, style, zone = 'right' }: { children: ReactNode; style: CSSProperties; zone?: string }) {
  return (
    <div className="st-float" data-tip-zone={zone} style={{ position: 'absolute', ...style }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

function ActBtn({ a, label, children }: { a: PlaneAction; label: string; children: ReactNode }) {
  return (
    <button type="button" className="st-ibtn" onClick={(e) => a.run(e.shiftKey)} disabled={a.disabled} aria-label={label} data-tip={a.tip}>
      {children}
    </button>
  );
}

/**
 * The image plane: every generation laid out on an endless canvas (newest row on top, a
 * batch side by side). Scroll or pinch to zoom, drag empty space (or right/middle-drag) to
 * pan, click to select, double-click to fit an image.
 */
export function ImagePlane(p: Props) {
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ W: 900, H: 700 });
  const [view, setView] = useState<View>({ x: 450, y: 80, z: 0.5 });
  const [animate, setAnimate] = useState(false);
  const [dims, setDims] = useState<Map<string, { w: number; h: number }>>(new Map());
  const [compareOn, setCompareOn] = useState(false);
  const [comparePos, setComparePos] = useState(50);
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean; scale: number; onTile: boolean } | null>(null);
  const justDragged = useRef(false);
  /** Tile the view is following (kept in place through layout changes until the user pans) */
  const follow = useRef<string | null>(null);
  const lastWheel = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const didInit = useRef(false);

  const tiles = useMemo(() => layoutTiles(p.entries, size.W, size.H, dims), [p.entries, size.W, size.H, dims]);
  const tilesRef = useRef(tiles);
  const sel = tiles.find((t) => t.id === p.selectedId) ?? null;

  // Plane size
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ W: el.clientWidth, H: el.clientHeight }));
    ro.observe(el);
    setSize({ W: el.clientWidth, H: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const focusTile = useCallback(
    (t: Tile, anim = true) => {
      const z = fitZoom(t.w, t.h, size.W, size.H);
      follow.current = t.id;
      setAnimate(anim);
      setView({ x: size.W / 2 - (t.left + t.w / 2) * z, y: size.H / 2 - (t.top + t.h / 2) * z, z });
    },
    [size.W, size.H],
  );

  const fitAll = useCallback(() => {
    const ts = tilesRef.current;
    if (!ts.length) return;
    const minX = Math.min(...ts.map((t) => t.left));
    const maxX = Math.max(...ts.map((t) => t.left + t.w));
    const maxY = Math.max(...ts.map((t) => t.top + t.h));
    const z = Math.max(0.02, Math.min((size.W - 96) / (maxX - minX), (size.H - 160) / maxY, 1.2));
    follow.current = null;
    setAnimate(true);
    setView({ x: size.W / 2 - ((minX + maxX) / 2) * z, y: 80, z });
  }, [size.W, size.H]);

  // Keep what's on screen in place when rows are added or removed above it
  useLayoutEffect(() => {
    const prev = tilesRef.current;
    tilesRef.current = tiles;
    if (!didInit.current) return;
    if (pendingFocus.current) {
      const t = tiles.find((x) => x.id === pendingFocus.current);
      if (t) {
        pendingFocus.current = null;
        const z = fitZoom(t.w, t.h, size.W, size.H);
        follow.current = t.id;
        setAnimate(true);
        setView({ x: size.W / 2 - (t.left + t.w / 2) * z, y: size.H / 2 - (t.top + t.h / 2) * z, z });
        return;
      }
    }
    // The followed tile went away (dismissed / deleted): move to the selection or its neighbour
    if (follow.current && !tiles.some((t) => t.id === follow.current)) {
      const gone = prev.findIndex((t) => t.id === follow.current);
      const nextTile =
        tiles.find((t) => t.id === p.selectedId) ??
        prev.slice(gone + 1).map((t) => tiles.find((n) => n.id === t.id)).find(Boolean) ??
        prev.slice(0, Math.max(0, gone)).reverse().map((t) => tiles.find((n) => n.id === t.id)).find(Boolean);
      follow.current = null;
      if (nextTile) {
        const z = fitZoom(nextTile.w, nextTile.h, size.W, size.H);
        follow.current = nextTile.id;
        setAnimate(true);
        setView({ x: size.W / 2 - (nextTile.left + nextTile.w / 2) * z, y: size.H / 2 - (nextTile.top + nextTile.h / 2) * z, z });
      }
      return;
    }
    const anchorId = follow.current ?? p.selectedId;
    const followed = follow.current ? tiles.find((t) => t.id === follow.current) : null;
    if (followed) {
      const z = fitZoom(followed.w, followed.h, size.W, size.H);
      setAnimate(false);
      setView({ x: size.W / 2 - (followed.left + followed.w / 2) * z, y: size.H / 2 - (followed.top + followed.h / 2) * z, z });
      return;
    }
    const a = anchorId ? prev.find((t) => t.id === anchorId) : null;
    const b = anchorId ? tiles.find((t) => t.id === anchorId) : null;
    const pa = a && b ? [a, b] : (() => {
      const common = prev.find((t) => tiles.some((n) => n.id === t.id));
      const n = common ? tiles.find((x) => x.id === common.id) : null;
      return common && n ? [common, n] : null;
    })();
    if (!pa) return;
    const dx = pa[1].left - pa[0].left;
    const dy = pa[1].top - pa[0].top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    setAnimate(false);
    setView((v) => ({ ...v, x: v.x - dx * v.z, y: v.y - dy * v.z }));
  }, [tiles]);

  // First view: the selected image, else everything
  useEffect(() => {
    if (didInit.current || !tiles.length || size.W < 50) return;
    didInit.current = true;
    const t = tiles.find((x) => x.id === p.selectedId);
    if (t) focusTile(t, false);
    else fitAll();
  }, [tiles, size.W, p.selectedId, focusTile, fitAll]);

  // Focus requests from the app (History click, arrow keys, a new image arriving)
  const focusN = p.focus?.n;
  /** A focus request for a tile that isn't laid out yet (e.g. a job that's just starting) */
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!p.focus) return;
    const t = tilesRef.current.find((x) => x.id === p.focus!.id);
    if (t) {
      pendingFocus.current = null;
      focusTile(t);
    } else {
      pendingFocus.current = p.focus.id;
    }
  }, [focusN]);

  useEffect(() => setCompareOn(false), [p.selectedId]);

  const zoomBy = useCallback(
    (f: number, mx?: number, my?: number) => {
      const v = viewRef.current;
      const cx = mx ?? size.W / 2;
      const cy = my ?? size.H / 2;
      const z = Math.min(6, Math.max(0.03, v.z * f));
      const k = z / v.z;
      follow.current = null;
      setAnimate(mx === undefined);
      setView({ x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, z });
    },
    [size.W, size.H],
  );

  // Wheel: pinch (ctrl) or mouse wheel zooms at the pointer; trackpad scroll pans
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest?.('.st-float, .st-errcard')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const scale = r.width / el.clientWidth || 1;
      const mx = (e.clientX - r.left) / scale;
      const my = (e.clientY - r.top) / scale;
      if (e.ctrlKey) {
        zoomBy(Math.exp(-e.deltaY * 0.01), mx, my);
        return;
      }
      const now = performance.now();
      const looksLikeMouse = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
      if (looksLikeMouse && now - lastWheel.current > 200) {
        zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 33 : 1) * 0.0015), mx, my);
        return;
      }
      lastWheel.current = now;
      follow.current = null;
      setAnimate(false);
      setView((v) => ({ ...v, x: v.x - e.deltaX / scale, y: v.y - e.deltaY / scale }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // Plane keys: 0 show all, 1 fit selected, +/- zoom, C compare
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.st-prefs')) return;
      if (e.key === '0') fitAll();
      else if (e.key === '1' && sel) focusTile(sel);
      else if (e.key === '=' || e.key === '+') zoomBy(1.25);
      else if (e.key === '-') zoomBy(0.8);
      else if (e.key.toLowerCase() === 'c' && p.compare) {
        setCompareOn((c) => !c);
        setComparePos(50);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitAll, focusTile, p.compare, sel, zoomBy]);

  const onDown = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as Element).closest('.st-float, .st-errcard, .st-compare')) return;
    const onTile = Boolean((e.target as Element).closest('[data-tile]'));
    const pans = e.pointerType === 'touch' || e.button === 2 || e.button === 1 || (e.button === 0 && !onTile);
    if (!pans && !(e.button === 0 && onTile)) return;
    if (e.button === 1) e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, scale: r.width / e.currentTarget.clientWidth || 1, onTile: onTile && e.button === 0 && e.pointerType !== 'touch' };
  };
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.scale;
    const dy = (e.clientY - d.sy) / d.scale;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.dataset.stDragging = '1';
    }
    follow.current = null;
    setAnimate(false);
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onUp = () => {
    if (drag.current?.moved) {
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
    }
    delete document.body.dataset.stDragging;
    drag.current = null;
  };

  const screen = (t: Tile) => ({ x: view.x + t.left * view.z, y: view.y + t.top * view.z, w: t.w * view.z, h: t.h * view.z });
  const tr = animate ? `left .35s ${EASE}, top .35s ${EASE}, width .35s ${EASE}, height .35s ${EASE}` : 'none';

  let grid = 24 * view.z;
  while (grid < 14) grid *= 2;
  while (grid > 48) grid /= 2;
  const bg: CSSProperties =
    p.background === 'black'
      ? { backgroundColor: '#000', backgroundImage: 'none' }
      : p.background === 'neutral'
        ? { backgroundImage: 'none' }
        : { backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` };

  const failedTiles = tiles.filter((t) => t.entry.kind === 'failed');
  const showCompare = Boolean(compareOn && p.compare && sel && sel.entry.kind === 'record');
  const a = p.actions;

  // Wide planes get two bottom bars (size + seed / file actions); narrow ones combine them
  const wide = size.W >= 560;
  const fileButtons = p.info ? (
    <>
      <button type="button" className={`st-ibtn ${p.info.pinned ? 'on' : ''}`} onClick={p.info.onPin} aria-pressed={p.info.pinned} aria-label="Pin image" data-tip={p.info.pinned ? 'Unpin  ·  F' : 'Pin — keep it easy to find  ·  F'}>
        <PinIcon filled={p.info.pinned} />
      </button>
      <button type="button" className="st-ibtn" onClick={p.info.onCopyImage} aria-label="Copy image to clipboard" data-tip="Copy image to clipboard">
        <CopyImageIcon />
      </button>
      <button type="button" className="st-ibtn" onClick={p.info.onDownload} aria-label="Download image" data-tip="Download PNG (prompt and settings embedded)">
        <DownloadIcon />
      </button>
    </>
  ) : null;

  return (
    <main
      ref={ref}
      className="st-plane"
      aria-label="Image plane"
      style={{ ...bg, cursor: drag.current?.moved ? 'grabbing' : 'default', userSelect: 'none', touchAction: 'none' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      // Focusing a control near the edge scrolls even overflow-hidden boxes; the plane never scrolls
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0;
        e.currentTarget.scrollLeft = 0;
      }}
      onDragOver={(e) => {
        if (p.onDropFile && e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const f = e.dataTransfer.files?.[0];
        if (!f || !p.onDropFile) return;
        e.preventDefault();
        p.onDropFile(f);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (justDragged.current) return;
        const el = (e.target as Element).closest('[data-tile]');
        const t = el ? tiles.find((x) => x.id === el.getAttribute('data-tile')) : null;
        if (t && t.entry.kind === 'record') p.onContext(t, e.clientX, e.clientY);
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transformOrigin: '0 0',
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
          transition: animate ? `transform .35s ${EASE}` : 'none',
          ['--z' as string]: view.z,
        }}
      >
        {tiles.map((t) => {
          const e = t.entry;
          const on = t.id === p.selectedId;
          return (
            <button
              key={t.id}
              type="button"
              data-tile={t.id}
              data-tip=""
              className={`st-tile ${on ? 'on' : ''} ${e.kind === 'failed' ? 'failed' : ''}`}
              style={{ left: t.left, top: t.top, width: t.w, height: t.h }}
              aria-label={e.kind === 'record' ? `${(e.record.settings.userPrompt || e.record.settings.prompt).slice(0, 60)}` : e.kind === 'running' ? 'Generating' : 'Failed generation'}
              onClick={() => {
                if (!justDragged.current) p.onSelect(t);
              }}
              onDoubleClick={() => focusTile(t)}
            >
              {t.src ? (
                <img
                  src={t.src}
                  alt=""
                  draggable={false}
                  onLoad={(ev) => {
                    if (e.kind !== 'record' || !t.src) return;
                    const img = ev.currentTarget;
                    const known = dims.get(t.src);
                    if (!known || known.w !== img.naturalWidth || known.h !== img.naturalHeight) {
                      const src = t.src;
                      setDims((m) => new Map(m).set(src, { w: img.naturalWidth, h: img.naturalHeight }));
                    }
                  }}
                />
              ) : null}
              {e.kind === 'record' && e.pinned ? (
                <PinIcon filled className="st-tile-pin" />
              ) : null}
              {e.kind === 'running' ? (
                <span className="st-noise" style={{ backgroundColor: `rgba(40,38,44,${(0.85 * (1 - e.progress)).toFixed(2)})`, backdropFilter: `blur(${Math.round(22 * (1 - e.progress))}px)` }} />
              ) : null}

            </button>
          );
        })}
      </div>

      {showCompare && sel && p.compare ? (
        (() => {
          const r = screen(sel);
          return (
            <div
              className="st-compare"
              role="slider"
              aria-label="Before and after"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={comparePos}
              tabIndex={0}
              style={{ left: r.x, top: r.y, width: r.w, height: r.h, transition: tr }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  e.stopPropagation();
                  setComparePos((v) => Math.min(100, Math.max(0, v + (e.key === 'ArrowLeft' ? -5 : 5))));
                }
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                const b = e.currentTarget.getBoundingClientRect();
                setComparePos(Math.round(Math.min(100, Math.max(0, ((e.clientX - b.left) / b.width) * 100))));
              }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const b = e.currentTarget.getBoundingClientRect();
                setComparePos(Math.round(Math.min(100, Math.max(0, ((e.clientX - b.left) / b.width) * 100))));
              }}
            >
              <img src={p.compare.src} alt="Before" draggable={false} style={{ clipPath: `inset(0 ${100 - comparePos}% 0 0)` }} />
              <span className="st-compare-line" style={{ left: `${comparePos}%` }} />
              <span className="st-compare-knob" style={{ left: `${comparePos}%` }}>
                <Columns2 className="h-4 w-4" />
              </span>
              <span className="st-compare-tag" style={{ left: 10 }}>Before</span>
              <span className="st-compare-tag" style={{ right: 10 }}>{p.compare.kind}</span>
            </div>
          );
        })()
      ) : null}

      {failedTiles.map((t) => {
        if (t.entry.kind !== 'failed') return null;
        const f = t.entry.failed;
        const r = screen(t);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const full = r.w >= 300 && r.h >= 220;
        const compact = !full && r.w >= 130 && r.h >= 110;
        const base: CSSProperties = { left: cx, top: cy, transition: animate ? `left .35s ${EASE}, top .35s ${EASE}` : 'none' };
        if (full) {
          return (
            <div key={t.id} className="st-errcard" role="alert" style={{ ...base, width: Math.min(r.w - 24, 420), maxHeight: r.h - 24 }} onPointerDown={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#f0857f' }}>
                <TriangleAlert className="h-5 w-5 shrink-0" />
                Generation failed
              </div>
              <span className="truncate text-xs" style={{ color: 'var(--s-muted)' }}>{f.settings.userPrompt || f.label}</span>
              <div className="st-mono max-h-24 overflow-y-auto rounded-lg p-2 text-[11.5px] leading-snug" style={{ background: 'var(--s-ground)', userSelect: 'text' }}>
                {f.error}
              </div>
              <div className="flex justify-end gap-1.5">
                <button type="button" className="st-pill" onClick={() => p.failedActions.dismiss(f)} data-tip="Remove this failed job">Dismiss</button>
                <button type="button" className="st-pill" onClick={() => p.failedActions.copy(f)} data-tip="Copy the full error for a bug report">Copy error</button>
                <button type="button" className="st-pill st-pill-accent" onClick={() => p.failedActions.retry(f)} data-tip="Queue the same job again">Retry</button>
              </div>
            </div>
          );
        }
        if (compact) {
          return (
            <div key={t.id} className="st-errcard items-center text-center" role="alert" style={{ ...base, width: Math.min(r.w - 12, 180), padding: 10 }} onPointerDown={(e) => e.stopPropagation()}>
              <span className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: '#f0857f' }}>
                <TriangleAlert className="h-4 w-4" /> Failed
              </span>
              <button type="button" className="st-pill st-pill-accent h-[26px] w-full justify-center text-xs" onClick={() => p.failedActions.retry(f)} data-tip="Queue the same job again">Retry</button>
              <button type="button" className="st-pill h-[26px] w-full justify-center text-xs" onClick={() => focusTile(t)} data-tip="Zoom in to see the full error">Details</button>
            </div>
          );
        }
        return (
          <button
            key={t.id}
            type="button"
            className="st-errdot"
            style={base}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => focusTile(t)}
            aria-label="Generation failed — show the error"
            data-tip="Generation failed — click for details"
          >
            !
          </button>
        );
      })}

      {p.overlay}

      {p.progress !== null ? (
        <div className="absolute left-0 right-0 top-0 h-[3px]">
          <div className="h-full" style={{ width: `${p.progress * 100}%`, background: 'var(--s-accent)', boxShadow: '0 0 12px var(--s-accent)', transition: 'width .12s linear' }} />
        </div>
      ) : null}

      {tiles.length ? (
        <Float style={{ top: 16, left: '50%', transform: 'translateX(-50%)' }}>
          <ActBtn a={a.enhance} label="Enhance"><EnhanceIcon /></ActBtn>
          <ActBtn a={a.vary} label="Generate variation"><VaryIcon /></ActBtn>
          <ActBtn a={a.upscale} label="Upscale"><UpscaleIcon /></ActBtn>
          <span className="st-vsep" />
          <ActBtn a={a.useAsBase} label="Use as base image"><UseAsBaseIcon /></ActBtn>
          <ActBtn a={a.edit} label="Edit image"><EditIcon /></ActBtn>
          <ActBtn a={a.inpaint} label="Inpaint or extend"><InpaintIcon /></ActBtn>
        </Float>
      ) : null}

      {sel ? (
        <Float style={{ left: 16, bottom: 16 }}>
          {p.compare && p.info ? (
            <>
              <button
                type="button"
                className={`st-ibtn ${compareOn ? 'on' : ''}`}
                onClick={() => {
                  setCompareOn((c) => !c);
                  setComparePos(50);
                }}
                aria-pressed={compareOn}
                aria-label="Compare with the original"
                data-tip={`Compare with the original (${p.compare.kind})  ·  C`}
              >
                <CompareIcon />
              </button>
              <span className="st-vsep" />
            </>
          ) : null}
          <span className="st-mono inline-flex h-10 items-center gap-2 px-3 text-[13.5px]" tabIndex={0} data-tip={`Aspect ratio ${ratioLabel(sel.w, sel.h)} — size in pixels`}>
            <span style={{ color: 'var(--s-muted)' }}>{ratioLabel(sel.w, sel.h)}</span>
            {Math.round(sel.w / WORLD_SCALE)}
            <span style={{ color: 'var(--s-faint)' }}>×</span>
            {Math.round(sel.h / WORLD_SCALE)}
          </span>
          {p.info && p.info.seed !== null ? (
            <>
              <span className="st-vsep" />
              {wide ? (
                <>
                  <span className="st-mono inline-flex h-10 items-center gap-2 pl-2.5 pr-1 text-[13.5px]" tabIndex={0} data-tip="Seed used for this image">
                    <SeedIcon className="h-[18px] w-[18px]" />
                    {p.info.seed}
                  </span>
                  <button type="button" className="st-ibtn" onClick={p.info.onCopySeed} aria-label="Copy seed" data-tip="Copy seed">
                    <CopyIcon />
                  </button>
                </>
              ) : (
                <button type="button" className="st-ibtn" onClick={p.info.onCopySeed} aria-label={`Copy seed ${p.info.seed}`} data-tip={`Seed ${p.info.seed} — click to copy`}>
                  <SeedIcon />
                </button>
              )}
            </>
          ) : null}
          {p.info && !wide ? (
            <>
              <span className="st-vsep" />
              {fileButtons}
            </>
          ) : null}
        </Float>
      ) : null}

      {p.info && wide ? (
        <Float style={{ right: 16, bottom: 16 }} zone="left">
          {fileButtons}
        </Float>
      ) : null}

      {p.toast ? (
        <div className="st-toast" role="status" style={{ bottom: sel ? 76 : 20 }}>
          <span className="pr-2">{p.toast.text}</span>
          {p.toast.action ? (
            <button type="button" className="st-pill h-[26px]" style={{ color: 'var(--s-accent)' }} onClick={p.toast.action.run}>
              {p.toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

export { tileId };
