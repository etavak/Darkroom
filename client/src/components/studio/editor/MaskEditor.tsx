import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Check, Redo2, Trash2, Undo2, X } from 'lucide-react';

export type Pad = { l: number; t: number; r: number; b: number };
export type MaskResult = {
  /** White (opaque) = redraw, at the padded size */
  mask: HTMLCanvasElement;
  pad: Pad;
  srcW: number;
  srcH: number;
  /** Share of the canvas that is masked, 0–1 */
  coverage: number;
};

type Tool = 'brush' | 'eraser' | 'fill' | 'resize';
type Look = { size: number; square: boolean; color: string; opacity: number; border: boolean; pattern: string };

const LOOK_KEY = 'darkroom.maskLook';
const DEFAULT_LOOK: Look = { size: 8, square: false, color: '#6b6bcf', opacity: 60, border: true, pattern: 'lines' };
const NO_PAD: Pad = { l: 0, t: 0, r: 0, b: 0 };
const MAX_PAD = 1024;

const COLORS: Array<[string, string]> = [
  ['#6b6bcf', 'Periwinkle'], ['#e2b44f', 'Amber'], ['#c058b4', 'Magenta'], ['#5fbcbf', 'Teal'], ['#d1534f', 'Red'],
  ['#66bb63', 'Green'], ['#ac72d8', 'Lilac'], ['#d48d4a', 'Orange'], ['#5b8fd3', 'Blue'], ['#b4b55a', 'Olive'],
];
const FG = 'var(--s-text)';
const PATTERNS: Array<{ id: string; name: string; bg: string; bs: string; glyph?: string }> = [
  { id: 'solid', name: 'Solid', bg: FG, bs: 'auto' },
  { id: 'lines', name: 'Diagonal lines', bg: `repeating-linear-gradient(45deg, ${FG} 0 1.5px, transparent 1.5px 4.5px)`, bs: 'auto' },
  { id: 'cross', name: 'Crosshatch', bg: `repeating-linear-gradient(45deg, ${FG} 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, ${FG} 0 1px, transparent 1px 4px)`, bs: 'auto' },
  { id: 'dots', name: 'Dots', bg: `radial-gradient(circle, ${FG} 1.4px, transparent 1.8px)`, bs: '7px 7px' },
  { id: 'grid', name: 'Grid', bg: `linear-gradient(${FG} 1px, transparent 1px), linear-gradient(90deg, ${FG} 1px, transparent 1px)`, bs: '5.5px 5.5px' },
  { id: 'checker', name: 'Checker', bg: `repeating-conic-gradient(${FG} 0 25%, transparent 0 50%)`, bs: '8px 8px' },
  { id: 'hearts', name: 'Hearts', bg: 'transparent', bs: 'auto', glyph: '♥♥' },
];

const TOOLS: Array<{ id: Tool; name: string; tip: string; d: string[] }> = [
  { id: 'brush', name: 'Brush', tip: 'Brush — paint the area to redraw  ·  B', d: ['M9.5 14.5 18 6a2.1 2.1 0 0 1 3 3l-8.5 8.5', 'M9.5 14.5c-2 0-3.5 1.5-3.5 3.5 0 1.2-.8 2-2 2 4 1 7.5-.5 7.5-3.5z'] },
  { id: 'eraser', name: 'Eraser', tip: 'Eraser — remove mask  ·  E', d: ['M7 21h10', 'm5.5 15.5 9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 19H9z', 'm10 11 5 5'] },
  { id: 'fill', name: 'Fill', tip: 'Fill — mask a whole enclosed area  ·  F', d: ['m5 11 6-6 8 8-6 6a2 2 0 0 1-2.8 0L5 13.8a2 2 0 0 1 0-2.8z', 'M5 12h14', 'M20.5 16s1.5 1.8 1.5 3a1.5 1.5 0 0 1-3 0c0-1.2 1.5-3 1.5-3z'] },
  { id: 'resize', name: 'Extend', tip: 'Extend / shift edges — grow the canvas to outpaint  ·  R', d: ['M8.5 7h7A1.5 1.5 0 0 1 17 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 15.5v-7A1.5 1.5 0 0 1 8.5 7z', 'M3 8V3h5M21 16v5h-5', 'M3 3l4 4M21 21l-4-4'] },
];

function ToolIcon({ d, size = 20 }: { d: string[]; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

function loadLook(): Look {
  try {
    return { ...DEFAULT_LOOK, ...(JSON.parse(localStorage.getItem(LOOK_KEY) || '{}') as Partial<Look>) };
  } catch {
    return DEFAULT_LOOK;
  }
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = newCanvas(src.width, src.height);
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}
const samePad = (a: Pad, b: Pad) => a.l === b.l && a.t === b.t && a.r === b.r && a.b === b.b;

type Props = {
  /** Image URL to edit */
  src: string;
  /** A previously saved mask (padded size) and padding to continue from */
  initialMask?: HTMLCanvasElement | null;
  initialPad?: Pad;
  onSave: (r: MaskResult) => void;
  onClose: () => void;
  /** Save button text: "Add to references" (new) or "Update reference" (editing the current one) */
  saveLabel?: string;
  /** Phone layout: header + bottom panel; one finger paints, two fingers zoom and move */
  compact?: boolean;
};

/**
 * Inpaint & extend: paint what to redraw (brush, eraser, fill) and/or drag the edges out to
 * extend the canvas. Scroll or pinch to zoom; right-drag, middle-drag or Space-drag to pan.
 */
export function MaskEditor({ src, initialMask, initialPad, onSave, onClose, saveLabel = 'Add to references', compact }: Props) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [tool, setTool] = useState<Tool>('brush');
  const [look, setLookState] = useState<Look>(loadLook);
  const [pad, setPadState] = useState<Pad>(initialPad ?? NO_PAD);
  const [optsOpen, setOptsOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [stage, setStage] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [space, setSpace] = useState(false);
  const [rev, setRev] = useState(0);
  const [frozenK, setFrozenK] = useState<number | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const zoomTextRef = useRef<HTMLSpanElement>(null);
  const mask = useRef<HTMLCanvasElement | null>(null);
  const hist = useRef<Array<{ mask: HTMLCanvasElement; pad: Pad }>>([]);
  const histIdx = useRef(0);
  const stroke = useRef<{ last: { x: number; y: number } } | null>(null);
  const panDrag = useRef<{ sx: number; sy: number; x0: number; y0: number; zoom: number; f: number } | null>(null);
  const edgeDrag = useRef<{ kind: 'shift' | 'edge'; side?: keyof Pad; sx: number; sy: number; fac: number; pad0: Pad; mask0: HTMLCanvasElement } | null>(null);
  const live = useRef<{ zoom: number; x: number; y: number } | null>(null);
  const commitT = useRef(0);
  const raf = useRef(0);
  const dirty = useRef<null | 'all' | { x0: number; y0: number; x1: number; y1: number }>(null);
  const patCache = useRef(new Map<string, HTMLCanvasElement>());
  const tmp = useRef<HTMLCanvasElement | null>(null);
  const lastPtr = useRef<{ clientX: number; clientY: number } | null>(null);
  const spaceDown = useRef(false);
  /** Pointer capture can throw for a pointer the browser no longer tracks; never let that stop painting */
  const capture = (e: RPointerEvent<Element>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };
  /** Touch points on the canvas, for two-finger zoom / pan */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; mx: number; my: number; zoom: number; x: number; y: number; f: number } | null>(null);
  const [gestured, setGestured] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const padRef = useRef(pad);
  padRef.current = pad;
  const lookRef = useRef(look);
  lookRef.current = look;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const setLook = (patch: Partial<Look>) =>
    setLookState((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(LOOK_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable
      }
      return next;
    });

  // Load the image to learn its pixel size; start the mask (or continue the saved one)
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const p = initialPad ?? NO_PAD;
      const resume = Boolean(initialMask && initialMask.width === w + p.l + p.r && initialMask.height === h + p.t + p.b);
      const startPad = resume ? p : NO_PAD;
      mask.current = resume && initialMask ? cloneCanvas(initialMask) : newCanvas(w, h);
      padRef.current = startPad;
      setPadState(startPad);
      hist.current = [{ mask: cloneCanvas(mask.current), pad: startPad }];
      histIdx.current = 0;
      setDims({ w, h });
    };
    img.onerror = () => setFailed(true);
    img.src = src;
    // run once per opened image
  }, [src]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const W = (dims?.w ?? 1) + pad.l + pad.r;
  const H = (dims?.h ?? 1) + pad.t + pad.b;
  const fitK = Math.min(stage.w / W, stage.h / H, 1.25);
  const k = frozenK ?? fitK;
  const fw = W * k;
  const fh = H * k;
  const hasPad = !samePad(pad, NO_PAD);
  const scaleRef = useRef(1);
  scaleRef.current = k * view.zoom;

  // ---------- drawing the mask overlay ----------
  const patternFor = useCallback((ctx: CanvasRenderingContext2D, id: string, color: string) => {
    const s = Math.max(6, Math.round(13 / (scaleRef.current || 1)));
    const key = `${id}|${color}|${s}`;
    let t = patCache.current.get(key);
    if (!t) {
      t = newCanvas(s, s);
      const c = t.getContext('2d')!;
      c.fillStyle = color;
      c.strokeStyle = color;
      if (id === 'solid') c.fillRect(0, 0, s, s);
      else {
        c.globalAlpha = 0.28;
        c.fillRect(0, 0, s, s);
        c.globalAlpha = 1;
        const lw = Math.max(1, s * 0.16);
        c.lineWidth = lw;
        const diag = (flip: boolean) => {
          for (const o of [-s, 0, s]) {
            c.beginPath();
            if (flip) {
              c.moveTo(o, 0);
              c.lineTo(o + s, s);
            } else {
              c.moveTo(o, s);
              c.lineTo(o + s, 0);
            }
            c.stroke();
          }
        };
        if (id === 'lines') diag(false);
        if (id === 'cross') {
          diag(false);
          diag(true);
        }
        if (id === 'dots') {
          c.beginPath();
          c.arc(s / 2, s / 2, s * 0.2, 0, Math.PI * 2);
          c.fill();
        }
        if (id === 'grid') {
          c.fillRect(0, 0, s, lw);
          c.fillRect(0, 0, lw, s);
        }
        if (id === 'checker') {
          c.fillRect(0, 0, s / 2, s / 2);
          c.fillRect(s / 2, s / 2, s / 2, s / 2);
        }
        if (id === 'hearts') {
          const h = s * 0.3;
          const cx = s / 2;
          const cy = s / 2 + h * 0.15;
          c.beginPath();
          c.moveTo(cx, cy + h * 0.9);
          c.bezierCurveTo(cx - h * 1.6, cy - h * 0.2, cx - h * 0.6, cy - h * 1.4, cx, cy - h * 0.5);
          c.bezierCurveTo(cx + h * 0.6, cy - h * 1.4, cx + h * 1.6, cy - h * 0.2, cx, cy + h * 0.9);
          c.fill();
        }
      }
      patCache.current.set(key, t);
    }
    return ctx.createPattern(t, 'repeat')!;
  }, []);

  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, m: HTMLCanvasElement, x: number, y: number, w: number, h: number) => {
      const lk = lookRef.current;
      ctx.clearRect(x, y, w, h);
      if (!tmp.current) tmp.current = newCanvas(1, 1);
      const t = tmp.current;
      if (t.width !== m.width || t.height !== m.height) {
        t.width = m.width;
        t.height = m.height;
      }
      const tc = t.getContext('2d')!;
      tc.save();
      tc.beginPath();
      tc.rect(x, y, w, h);
      tc.clip();
      tc.globalCompositeOperation = 'source-over';
      tc.clearRect(x, y, w, h);
      tc.fillStyle = patternFor(tc, lk.pattern, lk.color);
      tc.fillRect(x, y, w, h);
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(m, 0, 0);
      ctx.globalAlpha = lk.opacity / 100;
      ctx.drawImage(t, x, y, w, h, x, y, w, h);
      ctx.globalAlpha = 1;
      if (lk.border) {
        const r = Math.max(2, Math.round(2 / (scaleRef.current || 1)));
        tc.globalCompositeOperation = 'source-over';
        tc.clearRect(x, y, w, h);
        for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) tc.drawImage(m, ox, oy);
        tc.globalCompositeOperation = 'destination-out';
        tc.drawImage(m, 0, 0);
        tc.globalCompositeOperation = 'source-in';
        tc.fillStyle = lk.color;
        tc.fillRect(x, y, w, h);
        tc.globalCompositeOperation = 'source-over';
        ctx.drawImage(t, x, y, w, h, x, y, w, h);
      }
      tc.restore();
    },
    [patternFor],
  );

  const redraw = useCallback(
    (rect: { x0: number; y0: number; x1: number; y1: number } | null) => {
      const cv = canvasRef.current;
      const m = mask.current;
      if (!cv || !m) return;
      let full = !rect;
      if (cv.width !== m.width || cv.height !== m.height) {
        cv.width = m.width;
        cv.height = m.height;
        full = true;
      }
      const ctx = cv.getContext('2d')!;
      if (!full && rect) {
        // Painting: only the touched area (plus the outline's reach)
        const p = Math.ceil(Math.max(2, 2 / (scaleRef.current || 1))) + 2;
        const x0 = Math.max(0, Math.floor(rect.x0 - p));
        const y0 = Math.max(0, Math.floor(rect.y0 - p));
        const x1 = Math.min(m.width, Math.ceil(rect.x1 + p));
        const y1 = Math.min(m.height, Math.ceil(rect.y1 + p));
        if (x1 <= x0 || y1 <= y0) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, x1 - x0, y1 - y0);
        ctx.clip();
        paint(ctx, m, x0, y0, x1 - x0, y1 - y0);
        ctx.restore();
        return;
      }
      paint(ctx, m, 0, 0, m.width, m.height);
    },
    [paint],
  );

  const queueRedraw = useCallback(
    (rect?: { x0: number; y0: number; x1: number; y1: number }) => {
      if (!rect) dirty.current = 'all';
      else if (dirty.current !== 'all') {
        const d = dirty.current;
        dirty.current = d ? { x0: Math.min(d.x0, rect.x0), y0: Math.min(d.y0, rect.y0), x1: Math.max(d.x1, rect.x1), y1: Math.max(d.y1, rect.y1) } : rect;
      }
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        const d = dirty.current;
        dirty.current = null;
        redraw(d === 'all' ? null : d);
      });
    },
    [redraw],
  );

  // Full repaint when the look, the zoom (pattern scale), the mask or its size changes
  const lookKey = `${look.pattern}|${look.color}|${look.opacity}|${look.border}|${Math.round(k * view.zoom * 20)}|${rev}|${W}x${H}|${dims ? 1 : 0}`;
  useEffect(() => {
    queueRedraw();
  }, [lookKey, queueRedraw]);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  // ---------- history ----------
  const pushHist = (p: Pad = padRef.current) => {
    if (!mask.current) return;
    hist.current = hist.current.slice(0, histIdx.current + 1);
    hist.current.push({ mask: cloneCanvas(mask.current), pad: { ...p } });
    if (hist.current.length > 40) hist.current.shift();
    histIdx.current = hist.current.length - 1;
    setRev((r) => r + 1);
  };
  const restoreHist = (i: number) => {
    if (i < 0 || i >= hist.current.length) return;
    histIdx.current = i;
    const h = hist.current[i];
    mask.current = cloneCanvas(h.mask);
    setPadState({ ...h.pad });
    setRev((r) => r + 1);
  };

  /** Move the mask to a new padding: it stays attached to the image; edges outside are clipped. */
  const relocate = (from: HTMLCanvasElement, fromPad: Pad, toPad: Pad) => {
    const c = newCanvas((dims?.w ?? 1) + toPad.l + toPad.r, (dims?.h ?? 1) + toPad.t + toPad.b);
    c.getContext('2d')!.drawImage(from, toPad.l - fromPad.l, toPad.t - fromPad.t);
    return c;
  };
  const setPad = (next: Pad, record: boolean) => {
    if (!mask.current) return;
    mask.current = relocate(mask.current, padRef.current, next);
    padRef.current = next;
    setPadState(next);
    setRev((r) => r + 1);
    if (record) pushHist(next);
  };

  // ---------- view (zoom / pan) without re-rendering on every frame ----------
  const curView = () => live.current ?? view;
  const writeView = (v: { zoom: number; x: number; y: number }) => {
    live.current = v;
    if (frameRef.current) frameRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
    // Update React's own text node so later renders keep working
    const tn = zoomTextRef.current?.firstChild;
    if (tn) tn.nodeValue = `${Math.round(fitK * v.zoom * 100)}%`;
    if (lastPtr.current && !panDrag.current) requestAnimationFrame(() => lastPtr.current && moveRing(lastPtr.current));
    window.clearTimeout(commitT.current);
    commitT.current = window.setTimeout(() => {
      const c = live.current;
      live.current = null;
      if (c) setView(c);
    }, 160);
  };
  const zoomAt = (factor: number, px = 0, py = 0) => {
    const v = curView();
    const zoom = Math.min(8, Math.max(0.25, v.zoom * factor));
    const f = zoom / v.zoom;
    writeView({ zoom, x: px - (px - v.x) * f, y: py - (py - v.y) * f });
  };
  const resetView = () => {
    window.clearTimeout(commitT.current);
    live.current = null;
    setView({ zoom: 1, x: 0, y: 0 });
  };

  // Wheel: pinch (ctrl) or mouse wheel zooms at the pointer; trackpad scroll pans
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const f = r.width / el.clientWidth || 1;
      const px = (e.clientX - r.left) / f - el.clientWidth / 2;
      const py = (e.clientY - r.top) / f - el.clientHeight / 2;
      const mouse = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || mouse) {
        const step = e.ctrlKey ? 0.01 : 0.0015 * (e.deltaMode === 1 ? 33 : 1);
        zoomAt(Math.exp(-e.deltaY * step), px, py);
      } else {
        const v = curView();
        writeView({ zoom: v.zoom, x: v.x - e.deltaX / f, y: v.y - e.deltaY / f });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // ---------- painting ----------
  const brushPx = () => lookRef.current.size * 6;
  const pointOf = (e: { clientX: number; clientY: number }) => {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
  };
  const segBox = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const w = brushPx() / 2 + 2;
    return { x0: Math.min(a.x, b.x) - w, y0: Math.min(a.y, b.y) - w, x1: Math.max(a.x, b.x) + w, y1: Math.max(a.y, b.y) + w };
  };
  const stamp = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const ctx = mask.current!.getContext('2d')!;
    const w = brushPx();
    ctx.save();
    ctx.globalCompositeOperation = toolRef.current === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    if (lookRef.current.square) {
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (w / 4)));
      for (let i = 0; i <= n; i++) {
        const x = a.x + ((b.x - a.x) * i) / n;
        const y = a.y + ((b.y - a.y) * i) / n;
        ctx.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), w, w);
      }
    } else {
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x, b.y, w / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };
  /** Bucket fill of the empty region under (px, py), bounded by the painted mask and the edges. */
  const flood = (px: number, py: number) => {
    const m = mask.current!;
    const Wm = m.width;
    const Hm = m.height;
    if (px < 0 || py < 0 || px >= Wm || py >= Hm) return false;
    const ctx = m.getContext('2d')!;
    const img = ctx.getImageData(0, 0, Wm, Hm);
    const d = img.data;
    const empty = (x: number, y: number) => d[(y * Wm + x) * 4 + 3] < 128;
    if (!empty(px, py)) return false;
    const stack: Array<[number, number]> = [[px, py]];
    while (stack.length) {
      const [sx, y] = stack.pop()!;
      let x = sx;
      while (x > 0 && empty(x - 1, y)) x--;
      let up = false;
      let down = false;
      while (x < Wm && empty(x, y)) {
        const i = (y * Wm + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 255;
        if (y > 0) {
          const e = empty(x, y - 1);
          if (e && !up) stack.push([x, y - 1]);
          up = e;
        }
        if (y < Hm - 1) {
          const e = empty(x, y + 1);
          if (e && !down) stack.push([x, y + 1]);
          down = e;
        }
        x++;
      }
    }
    ctx.putImageData(img, 0, 0);
    return true;
  };

  const moveRing = (e: { clientX: number; clientY: number }) => {
    const ring = ringRef.current;
    const cv = canvasRef.current;
    if (!ring || !cv) return;
    const t = toolRef.current;
    if ((t !== 'brush' && t !== 'eraser') || spaceDown.current || panDrag.current) {
      ring.style.display = 'none';
      return;
    }
    const p = pointOf(e);
    const f = cv.clientWidth / cv.width;
    const w = brushPx() * f;
    ring.style.display = 'block';
    ring.style.width = `${w}px`;
    ring.style.height = `${w}px`;
    ring.style.borderRadius = lookRef.current.square ? '2px' : '50%';
    ring.style.transform = `translate(${p.x * f - w / 2}px, ${p.y * f - w / 2}px)`;
  };

  const startEdge = (e: RPointerEvent, kind: 'shift' | 'edge', side?: keyof Pad) => {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    edgeDrag.current = { kind, side, sx: e.clientX, sy: e.clientY, fac: cv.width / r.width, pad0: { ...padRef.current }, mask0: cloneCanvas(mask.current!) };
    // Keep the scale still while dragging so the edge follows the pointer
    setFrozenK(k);
  };
  const edgeMove = (e: { clientX: number; clientY: number }) => {
    const d = edgeDrag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) * d.fac;
    const dy = (e.clientY - d.sy) * d.fac;
    const p0 = d.pad0;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const snap = (v: number, q: number) => Math.round(v / q) * q;
    let next: Pad;
    if (d.kind === 'shift') {
      const tx = p0.l + p0.r;
      const ty = p0.t + p0.b;
      const l = clamp(snap(p0.l + dx, 8), 0, tx);
      const t = clamp(snap(p0.t + dy, 8), 0, ty);
      next = { l, r: tx - l, t, b: ty - t };
    } else {
      // The frame stays centred, so an edge moves half as far as the canvas grows
      const g = { l: -2 * dx, r: 2 * dx, t: -2 * dy, b: 2 * dy }[d.side!];
      next = { ...p0, [d.side!]: clamp(snap(p0[d.side!] + g, 64), 0, MAX_PAD) };
    }
    if (samePad(next, padRef.current)) return;
    mask.current = relocate(d.mask0, p0, next);
    padRef.current = next;
    setPadState(next);
    setRev((r) => r + 1);
  };
  const edgeEnd = () => {
    const d = edgeDrag.current;
    if (!d) return;
    edgeDrag.current = null;
    setFrozenK(null);
    if (!samePad(padRef.current, d.pad0)) pushHist(padRef.current);
  };

  const startPinch = () => {
    const pts = [...touches.current.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const st = stageRef.current;
    const f = st ? st.getBoundingClientRect().width / st.clientWidth || 1 : 1;
    const v = curView();
    pinch.current = { d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, zoom: v.zoom, x: v.x, y: v.y, f };
  };
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!mask.current) return;
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      capture(e);
      if (touches.current.size >= 2) {
        // A second finger: this is a zoom / pan, not paint — take back the stroke just started
        if (stroke.current) {
          stroke.current = null;
          const h = hist.current[histIdx.current];
          if (h) mask.current = cloneCanvas(h.mask);
          queueRedraw();
        }
        edgeDrag.current = null;
        setFrozenK(null);
        setGestured(true);
        startPinch();
        return;
      }
    }
    if ((e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) || (spaceDown.current && e.button === 0)) {
      e.preventDefault();
      capture(e);
      const st = stageRef.current;
      const f = st ? st.getBoundingClientRect().width / st.clientWidth || 1 : 1;
      const v = curView();
      panDrag.current = { sx: e.clientX, sy: e.clientY, x0: v.x, y0: v.y, zoom: v.zoom, f };
      if (ringRef.current) ringRef.current.style.display = 'none';
      setPanning(true);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setOptsOpen(false);
    setConfirm(false);
    setNotice(null);
    capture(e);
    const p = pointOf(e);
    if (tool === 'fill') {
      if (flood(Math.floor(p.x), Math.floor(p.y))) {
        pushHist();
        queueRedraw();
      } else setNotice('That spot is already masked — fill works on empty areas.');
      return;
    }
    if (tool === 'resize') {
      if (hasPad) startEdge(e, 'shift');
      return;
    }
    stroke.current = { last: p };
    stamp(p, p);
    queueRedraw(segBox(p, p));
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = pinch.current;
      if (g && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()];
        const zoom = Math.min(8, Math.max(0.25, g.zoom * (Math.hypot(b.x - a.x, b.y - a.y) / g.d0)));
        const st = stageRef.current!.getBoundingClientRect();
        // Keep the point between the fingers under them while zooming
        const cx = (g.mx - st.left) / g.f - stageRef.current!.clientWidth / 2;
        const cy = (g.my - st.top) / g.f - stageRef.current!.clientHeight / 2;
        const k = zoom / g.zoom;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        writeView({ zoom, x: cx - (cx - g.x) * k + (mx - g.mx) / g.f, y: cy - (cy - g.y) * k + (my - g.my) / g.f });
        return;
      }
      if (pinch.current) return;
    }
    lastPtr.current = { clientX: e.clientX, clientY: e.clientY };
    if (panDrag.current) {
      const d = panDrag.current;
      writeView({ zoom: d.zoom, x: d.x0 + (e.clientX - d.sx) / d.f, y: d.y0 + (e.clientY - d.sy) / d.f });
      return;
    }
    moveRing(e);
    if (edgeDrag.current) {
      edgeMove(e);
      return;
    }
    if (!stroke.current) return;
    const p = pointOf(e);
    stamp(stroke.current.last, p);
    queueRedraw(segBox(stroke.current.last, p));
    stroke.current.last = p;
  };
  const onUp = (e?: RPointerEvent<HTMLCanvasElement>) => {
    if (e?.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (pinch.current) {
        // Lift both fingers before painting again
        if (touches.current.size === 0) pinch.current = null;
        return;
      }
    }
    if (panDrag.current) {
      panDrag.current = null;
      setPanning(false);
      return;
    }
    if (edgeDrag.current) {
      edgeEnd();
      return;
    }
    if (stroke.current) {
      stroke.current = null;
      pushHist();
    }
  };

  // ---------- save / close ----------
  const changed = () => histIdx.current > 0;
  const save = () => {
    const m = mask.current;
    if (!m || !dims) return;
    const d = m.getContext('2d')!.getImageData(0, 0, m.width, m.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] >= 128) n++;
    const coverage = (n * 4) / (m.width * m.height);
    if (!n && !hasPad) {
      setNotice('Nothing to inpaint yet — paint a mask or drag an edge out.');
      return;
    }
    onSave({ mask: cloneCanvas(m), pad: { ...pad }, srcW: dims.w, srcH: dims.h, coverage });
  };
  const exit = () => {
    if (changed() && !confirm) {
      setConfirm(true);
      setOptsOpen(false);
      return;
    }
    onClose();
  };

  // Keys (capture phase, so the studio's own shortcuts don't fire underneath)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range');
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (optsOpen || confirm) {
        setOptsOpen(false);
        setConfirm(false);
      } else exit();
      return;
    }
    if (typing) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      restoreHist(histIdx.current + (e.shiftKey ? 1 : -1));
    } else if (mod && key === 'y') {
      e.preventDefault();
      restoreHist(histIdx.current + 1);
    } else if (mod && e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      zoomAt(1.25);
    } else if (mod && e.key === '-') {
      e.preventDefault();
      zoomAt(0.8);
    } else if (mod && e.key === '0') {
      e.preventDefault();
      resetView();
    } else if (e.key === ' ') {
      e.preventDefault();
      if (!spaceDown.current) {
        spaceDown.current = true;
        if (ringRef.current) ringRef.current.style.display = 'none';
        setSpace(true);
      }
    } else if (!mod) {
      const tools: Record<string, Tool> = { b: 'brush', e: 'eraser', f: 'fill', r: 'resize' };
      if (tools[key]) {
        setTool(tools[key]);
        setOptsOpen(false);
      }
      if (e.key === '[') setLook({ size: Math.max(1, lookRef.current.size - 1) });
      if (e.key === ']') setLook({ size: Math.min(50, lookRef.current.size + 1) });
    }
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyRef.current(e);
    const up = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === ' ') {
        spaceDown.current = false;
        setSpace(false);
      }
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, []);

  const toolDef = TOOLS.find((t) => t.id === tool)!;
  const hl = 12 / view.zoom;
  const hs = 64 / view.zoom;
  const handles: Array<{ side: keyof Pad; tip: string; zone: string; l: number; t: number; w: number; h: number; cur: string }> = [
    { side: 'l', zone: 'left', tip: 'Drag to extend left', l: -hl / 2 - 2, t: fh / 2 - hs / 2, w: hl, h: hs, cur: 'ew-resize' },
    { side: 'r', zone: 'right', tip: 'Drag to extend right', l: fw - hl / 2 + 2, t: fh / 2 - hs / 2, w: hl, h: hs, cur: 'ew-resize' },
    { side: 't', zone: 'above', tip: 'Drag to extend up', l: fw / 2 - hs / 2, t: -hl / 2 - 2, w: hs, h: hl, cur: 'ns-resize' },
    { side: 'b', zone: 'below', tip: 'Drag to extend down', l: fw / 2 - hs / 2, t: fh - hl / 2 + 2, w: hs, h: hl, cur: 'ns-resize' },
  ];
  const ext = (side: keyof Pad) => () => setPad({ ...pad, [side]: Math.min(MAX_PAD, pad[side] + 64) }, true);
  const cursor = panning ? 'grabbing' : space ? 'grab' : tool === 'resize' ? (hasPad ? 'move' : 'default') : tool === 'fill' ? 'crosshair' : 'none';
  const colorName = COLORS.find(([hex]) => hex === look.color)?.[1] ?? '';

  if (compact) {
    return (
      <div className="st-editor st-editor-c" role="dialog" aria-label="Inpaint and extend">
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-[max(10px,env(safe-area-inset-top))]">
          <button type="button" className="st-ibtn" onClick={exit} aria-label="Close without saving" data-tip="Close without saving">
            <X />
          </button>
          <span className="text-[15px] font-semibold">Inpaint &amp; extend</span>
          <button type="button" className="st-pill st-pill-accent h-[38px] px-4 font-semibold" onClick={save} data-tip="Put this on the Reference images card">
            {saveLabel}
          </button>
        </div>
        <div ref={stageRef} className="st-ed-stage-c" onContextMenu={(e) => e.preventDefault()}>
          {dims ? (
            <div
              ref={frameRef}
              className="st-ed-frame"
              style={{
                width: fw,
                height: fh,
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                backgroundImage: `repeating-conic-gradient(${look.color}b3 0 25%, #e6e6f2 0 50%)`,
              }}
            >
              <img src={src} alt="" draggable={false} style={{ left: pad.l * k, top: pad.t * k, width: dims.w * k, height: dims.h * k }} />
              <canvas
                ref={canvasRef}
                aria-label="Mask canvas"
                style={{ cursor }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onPointerLeave={() => {
                  if (compact) return;
                  lastPtr.current = null;
                  if (ringRef.current) ringRef.current.style.display = 'none';
                }}
              />
              {hasPad ? <div className="st-ed-src" style={{ left: pad.l * k, top: pad.t * k, width: dims.w * k, height: dims.h * k }} /> : null}
              <div ref={ringRef} className="st-ed-ring" />
              {tool === 'resize'
                ? handles.map((h) => (
                    <div
                      key={h.side}
                      className="st-ed-handle"
                      data-tip={h.tip}
                      data-tip-zone={h.zone}
                      style={{ left: h.l, top: h.t, width: h.w, height: h.h, cursor: h.cur, borderRadius: 5 / view.zoom }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        capture(e);
                        startEdge(e, 'edge', h.side);
                      }}
                      onPointerMove={edgeMove}
                      onPointerUp={edgeEnd}
                      onPointerCancel={edgeEnd}
                    />
                  ))
                : null}
            </div>
          ) : (
            <span style={{ color: 'var(--s-muted)' }}>{failed ? 'Couldn’t load the image.' : 'Loading…'}</span>
          )}
          {!gestured && dims ? <span className="st-ed-hint">One finger paints · two fingers zoom and move</span> : null}
        </div>
        {confirm ? (
          <div className="st-toast" role="alertdialog" style={{ top: 64, bottom: 'auto', whiteSpace: 'normal', maxWidth: 'calc(100% - 24px)' }}>
            <span className="pr-1 text-[13px]">Discard your changes?</span>
            <button type="button" className="st-pill h-[30px]" onClick={() => setConfirm(false)}>Keep</button>
            <button type="button" className="st-pill h-[30px]" style={{ background: '#b8433d', borderColor: 'transparent', color: '#fff' }} onClick={onClose}>
              Discard
            </button>
          </div>
        ) : notice ? (
          <div className="st-toast" role="status" style={{ top: 64, bottom: 'auto', whiteSpace: 'normal', maxWidth: 'calc(100% - 24px)' }}>
            <span className="text-[13px]">{notice}</span>
          </div>
        ) : null}
        <div className="st-ed-bottom" data-tip-zone="above">
          {tool === 'brush' || tool === 'eraser' ? (
            <label className="flex flex-col gap-1.5 px-1.5">
              <span className="flex justify-between">
                <span className="st-lbl text-[13px]">Brush size</span>
                <span className="st-mono font-semibold">{look.size}</span>
              </span>
              <input className="st-rng" type="range" min={1} max={50} value={look.size} onChange={(e) => setLook({ size: Number(e.target.value) })} aria-label="Brush size" />
            </label>
          ) : null}
          {tool === 'fill' ? (
            <p className="m-0 px-1.5 text-[13px]" style={{ color: 'var(--s-muted)' }}>
              Tap an empty area to fill it. Draw a closed outline first to fill just its inside.
            </p>
          ) : null}
          {tool === 'resize' ? (
            <div className="flex items-center gap-1.5 px-1.5">
              <span className="st-mono flex-1 text-[13px]">{dims ? (hasPad ? `${dims.w}×${dims.h} → ${W}×${H}` : `${W}×${H}`) : ''}</span>
              {([
                ['l', '←', 'Extend left 64 px'],
                ['t', '↑', 'Extend up 64 px'],
                ['b', '↓', 'Extend down 64 px'],
                ['r', '→', 'Extend right 64 px'],
              ] as const).map(([side, glyph, tip]) => (
                <button key={side} type="button" className="st-pill h-9 w-10 justify-center px-0" onClick={ext(side)} aria-label={tip} data-tip={tip}>
                  {glyph}
                </button>
              ))}
              <button type="button" className="st-pill h-9" disabled={!hasPad} onClick={() => setPad(NO_PAD, true)}>
                Reset
              </button>
            </div>
          ) : null}
          {colorsOpen ? (
            <div className="flex items-center gap-2 px-1.5">
              {COLORS.slice(0, 6).map(([hex, name]) => (
                <button
                  key={hex}
                  type="button"
                  className={`st-ed-swatch h-8 w-8 ${hex === look.color ? 'on' : ''}`}
                  style={{ background: hex }}
                  onClick={() => setLook({ color: hex })}
                  aria-label={name}
                  data-tip={name}
                />
              ))}
              <span className="flex-1" />
              <span className="st-lbl">Opacity</span>
              <input className="st-rng w-[90px]" type="range" min={20} max={90} step={10} value={look.opacity} onChange={(e) => setLook({ opacity: Number(e.target.value) })} aria-label="Mask opacity" />
            </div>
          ) : null}
          <div className="flex justify-between">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`st-ibtn ${t.id === tool ? 'on' : ''}`}
                onClick={() => setTool(t.id)}
                aria-label={t.name}
                aria-pressed={t.id === tool}
                data-tip={t.name}
              >
                <ToolIcon d={t.d} />
              </button>
            ))}
            <button type="button" className={`st-ibtn ${colorsOpen ? 'on' : ''}`} onClick={() => setColorsOpen((o) => !o)} aria-label="Mask colour" data-tip="Mask colour and opacity">
              <span className="h-5 w-5 rounded-full" style={{ background: look.color, boxShadow: '0 0 0 2px var(--s-ground), 0 0 0 3px var(--s-line)' }} />
            </button>
            <button type="button" className="st-ibtn" onClick={() => restoreHist(histIdx.current - 1)} disabled={histIdx.current <= 0} aria-label="Undo" data-tip="Undo">
              <Undo2 />
            </button>
            <button type="button" className="st-ibtn" onClick={() => restoreHist(histIdx.current + 1)} disabled={histIdx.current >= hist.current.length - 1} aria-label="Redo" data-tip="Redo">
              <Redo2 />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="st-editor" role="dialog" aria-label="Inpaint and extend">
      <div ref={stageRef} className="st-ed-stage" onContextMenu={(e) => e.preventDefault()}>
        {dims ? (
          <div
            ref={frameRef}
            className="st-ed-frame"
            style={{
              width: fw,
              height: fh,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              backgroundImage: `repeating-conic-gradient(${look.color}b3 0 25%, #e6e6f2 0 50%)`,
            }}
          >
            <img src={src} alt="" draggable={false} style={{ left: pad.l * k, top: pad.t * k, width: dims.w * k, height: dims.h * k }} />
            <canvas
              ref={canvasRef}
              aria-label="Mask canvas"
              style={{ cursor }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={() => {
                if (compact) return;
                lastPtr.current = null;
                if (ringRef.current) ringRef.current.style.display = 'none';
              }}
            />
            {hasPad ? <div className="st-ed-src" style={{ left: pad.l * k, top: pad.t * k, width: dims.w * k, height: dims.h * k }} /> : null}
            <div ref={ringRef} className="st-ed-ring" />
            {tool === 'resize'
              ? handles.map((h) => (
                  <div
                    key={h.side}
                    className="st-ed-handle"
                    data-tip={h.tip}
                    data-tip-zone={h.zone}
                    style={{ left: h.l, top: h.t, width: h.w, height: h.h, cursor: h.cur, borderRadius: 5 / view.zoom }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      capture(e);
                      startEdge(e, 'edge', h.side);
                    }}
                    onPointerMove={edgeMove}
                    onPointerUp={edgeEnd}
                    onPointerCancel={edgeEnd}
                  />
                ))
              : null}
          </div>
        ) : (
          <span style={{ color: 'var(--s-muted)' }}>{failed ? 'Couldn’t load the image.' : 'Loading…'}</span>
        )}
      </div>

      <div className="st-ed-panel" data-tip-zone="right">
        <div className="flex w-[88px] flex-col items-center justify-center gap-1.5 text-[13.5px] font-semibold" style={{ borderRight: '1px solid var(--s-line)' }}>
          <ToolIcon d={toolDef.d} />
          <span>{toolDef.name}</span>
        </div>
        <div className="flex w-[250px] flex-col justify-center gap-2 px-3.5 py-3">
          {tool === 'brush' || tool === 'eraser' ? (
            <>
              <label className="flex flex-col gap-1.5" data-tip="Brush size  ·  [ and ] to change">
                <span className="text-[13.5px] font-semibold">
                  Pen size: <span className="st-mono">{look.size}</span>
                </span>
                <input className="st-rng" type="range" min={1} max={50} value={look.size} onChange={(e) => setLook({ size: Number(e.target.value) })} aria-label="Pen size" />
              </label>
              <div className="flex items-center gap-2.5">
                <button type="button" className={`st-check ${look.square ? 'on' : ''}`} onClick={() => setLook({ square: !look.square })} aria-pressed={look.square} aria-label="Square brush" data-tip="Square brush — hard edges, good for exact areas">
                  {look.square ? <Check className="h-4 w-4" strokeWidth={2.4} /> : null}
                </button>
                <span className="text-[13.5px]">Square brush</span>
              </div>
            </>
          ) : null}
          {tool === 'fill' ? (
            <p className="m-0 text-[13px] leading-snug" style={{ color: 'var(--s-muted)' }}>
              Click an empty area to fill it. Draw a closed outline first to fill just its inside.
            </p>
          ) : null}
          {tool === 'resize' ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-[13.5px] font-semibold">Canvas</span>
                <span className="st-mono text-[13px]">{W} × {H}</span>
              </div>
              <div className="flex gap-1">
                {([
                  ['l', '←', 'Extend left 64 px'],
                  ['t', '↑', 'Extend up 64 px'],
                  ['b', '↓', 'Extend down 64 px'],
                  ['r', '→', 'Extend right 64 px'],
                ] as const).map(([side, glyph, tip]) => (
                  <button key={side} type="button" className="st-patbtn h-8 w-9 text-[15px]" onClick={ext(side)} aria-label={tip} data-tip={tip}>
                    {glyph}
                  </button>
                ))}
                <span className="flex-1" />
                <button type="button" className="st-pill" disabled={!hasPad} onClick={() => setPad(NO_PAD, true)} data-tip="Back to the original size">
                  Reset
                </button>
              </div>
              <p className="m-0 text-xs leading-snug" style={{ color: 'var(--s-muted)' }}>
                Drag an edge outward to extend. Drag the image to shift it inside the canvas.
              </p>
            </>
          ) : null}
        </div>
      </div>

      <div className="absolute right-4 top-4">
        <div className="st-float" data-tip-zone="left">
          <button type="button" className="st-gen h-10 px-4 text-sm" onClick={save} data-tip="Put this on the Reference images card for the next Generate  ·  Ctrl ↵">
            {saveLabel}
          </button>
          <button type="button" className="st-ibtn" onClick={exit} aria-label="Close without saving" data-tip="Close without saving  ·  Esc">
            <X />
          </button>
        </div>
        {confirm ? (
          <div className="st-menu" data-tip-avoid role="alertdialog" style={{ top: 62, left: 'auto', right: 0, width: 260, padding: 14, gap: 10 }}>
            <div className="text-sm font-semibold">Discard your changes?</div>
            <div className="text-[13px] leading-snug" style={{ color: 'var(--s-muted)' }}>
              The mask and canvas changes since you opened the editor will be lost.
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="st-pill" onClick={() => setConfirm(false)}>Keep editing</button>
              <button type="button" className="st-pill" style={{ background: '#b8433d', borderColor: 'transparent', color: '#fff' }} onClick={onClose}>
                Discard
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {notice ? (
        <div className="st-toast" role="status" style={{ bottom: 86 }}>
          <span className="pr-2">{notice}</span>
        </div>
      ) : null}

      <div className="st-float absolute bottom-5 left-1/2 -translate-x-1/2 gap-1" data-tip-zone="right">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`st-ibtn h-11 w-12 ${t.id === tool ? 'on' : ''}`}
            onClick={() => {
              setTool(t.id);
              setOptsOpen(false);
            }}
            aria-label={t.name}
            aria-pressed={t.id === tool}
            data-tip={t.tip}
          >
            <ToolIcon d={t.d} />
          </button>
        ))}
        <div className="w-[120px]" />
        <div className="relative">
          <button type="button" className={`st-ibtn h-11 w-12 ${optsOpen ? 'on' : ''}`} onClick={() => setOptsOpen((o) => !o)} aria-label="Mask colour and fill" aria-expanded={optsOpen} data-tip="Mask colour, opacity and pattern">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.4-9-7.4z" />
              <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
              <circle cx="10" cy="7" r="1.2" fill="currentColor" />
              <circle cx="15" cy="7.5" r="1.2" fill="currentColor" />
            </svg>
          </button>
          {optsOpen ? (
            <div className="st-menu" data-tip-avoid style={{ bottom: 'calc(100% + 14px)', left: '50%', transform: 'translateX(-50%)', width: 372, padding: 16, gap: 12 }}>
              <div className="st-lbl text-[13px]">
                Mask colour: <span style={{ color: 'var(--s-text)' }}>{colorName}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map(([hex, name]) => (
                  <button key={hex} type="button" className={`st-ed-swatch ${hex === look.color ? 'on' : ''}`} style={{ background: hex }} onClick={() => setLook({ color: hex })} aria-label={name} aria-pressed={hex === look.color} data-tip={name} />
                ))}
              </div>
              <label className="flex flex-col gap-1.5 pt-1">
                <span className="text-sm font-semibold">
                  Mask opacity: <span className="st-mono">{look.opacity}%</span>
                </span>
                <input className="st-rng" type="range" min={10} max={100} step={5} value={look.opacity} onChange={(e) => setLook({ opacity: Number(e.target.value) })} aria-label="Mask opacity" />
              </label>
              <div className="flex items-center gap-2.5">
                <button type="button" className={`st-check ${look.border ? 'on' : ''}`} onClick={() => setLook({ border: !look.border })} aria-pressed={look.border} aria-label="Border" data-tip="Outline the mask so thin areas stay visible">
                  {look.border ? <Check className="h-4 w-4" strokeWidth={2.4} /> : null}
                </button>
                <span className="text-sm">Border</span>
              </div>
              <div className="st-lbl pt-0.5 text-[13px]">
                Mask pattern: <span style={{ color: 'var(--s-text)' }}>{PATTERNS.find((p) => p.id === look.pattern)?.name}</span>
              </div>
              <div className="flex gap-1.5">
                {PATTERNS.map((p) => (
                  <button key={p.id} type="button" className={`st-patbtn ${p.id === look.pattern ? 'on' : ''}`} onClick={() => setLook({ pattern: p.id })} aria-label={p.name} aria-pressed={p.id === look.pattern} data-tip={p.name}>
                    <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[3px] text-[9px] leading-none tracking-[-1px]" style={{ background: p.bg, backgroundSize: p.bs }}>
                      {p.glyph ?? ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="st-ibtn h-11 w-12"
          onClick={() => {
            if (!mask.current) return;
            mask.current.getContext('2d')!.clearRect(0, 0, mask.current.width, mask.current.height);
            pushHist();
            queueRedraw();
          }}
          aria-label="Delete all masks"
          data-tip="Delete all masks"
        >
          <Trash2 />
        </button>
        <span className="st-vsep" />
        <button type="button" className="st-ibtn h-11 w-12" onClick={() => restoreHist(histIdx.current - 1)} disabled={histIdx.current <= 0} aria-label="Undo" data-tip="Undo  ·  Ctrl Z">
          <Undo2 />
        </button>
        <button type="button" className="st-ibtn h-11 w-12" onClick={() => restoreHist(histIdx.current + 1)} disabled={histIdx.current >= hist.current.length - 1} aria-label="Redo" data-tip="Redo  ·  Ctrl Shift Z">
          <Redo2 />
        </button>
      </div>

      <div className="st-float absolute bottom-5 left-4 gap-0.5" data-tip-zone="right">
        <button type="button" className="st-ibtn h-9 w-9 text-lg" onClick={() => zoomAt(0.8)} aria-label="Zoom out" data-tip="Zoom out  ·  Ctrl −">
          −
        </button>
        <button type="button" className="st-mono h-9 min-w-[58px] cursor-pointer rounded-lg border-0 bg-transparent text-[12.5px]" style={{ color: 'var(--s-text)' }} onClick={resetView} aria-label="Fit to screen" data-tip="Fit to screen  ·  Ctrl 0">
          <span ref={zoomTextRef}>{`${Math.round(fitK * view.zoom * 100)}%`}</span>
        </button>
        <button type="button" className="st-ibtn h-9 w-9 text-lg" onClick={() => zoomAt(1.25)} aria-label="Zoom in" data-tip="Zoom in  ·  Ctrl +  ·  scroll or pinch; right-drag or Space-drag to pan">
          +
        </button>
      </div>
      <span className="st-mono absolute bottom-7 right-4 rounded-lg px-2.5 py-1.5 text-[12.5px]" style={{ background: 'var(--s-panel)', border: '1px solid var(--s-line)', color: 'var(--s-muted)' }} data-tip="Output size after inpainting" data-tip-zone="left" tabIndex={0}>
        {dims ? (hasPad ? `${dims.w} × ${dims.h}  →  ${W} × ${H}` : `${W} × ${H}`) : ''}
      </span>
    </div>
  );
}
