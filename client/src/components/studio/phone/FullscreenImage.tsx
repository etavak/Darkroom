import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

type Props = {
  src: string;
  /** "3 / 12" */
  counter?: string;
  onClose: () => void;
  /** Swipe left (+1, older) / right (−1, newer) while not zoomed */
  onSwipe: (dir: 1 | -1) => void;
};

type View = { z: number; x: number; y: number };
const FIT: View = { z: 1, x: 0, y: 0 };

/**
 * The image on black, filling the screen. Pinch to zoom, drag to pan when zoomed,
 * double-tap to zoom in or back out, swipe sideways for the next image, swipe down or ✕ to
 * close, tap to show or hide the controls.
 */
export function FullscreenImage({ src, counter, onClose, onSwipe }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [chrome, setChrome] = useState(true);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<{ dy: number } | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<{
    kind: 'none' | 'pan' | 'pinch' | 'swipe';
    sx: number;
    sy: number;
    t: number;
    v0: View;
    d0: number;
    mx: number;
    my: number;
    moved: boolean;
  }>({ kind: 'none', sx: 0, sy: 0, t: 0, v0: FIT, d0: 1, mx: 0, my: 0, moved: false });
  const lastTap = useRef(0);
  const tapTimer = useRef(0);

  // A new image starts fitted
  useEffect(() => {
    setView(FIT);
    setNatural(null);
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onSwipe(1);
      if (e.key === 'ArrowLeft') onSwipe(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onSwipe]);
  useEffect(() => () => window.clearTimeout(tapTimer.current), []);

  const size = () => {
    const el = rootRef.current;
    return { W: el?.clientWidth ?? 390, H: el?.clientHeight ?? 800 };
  };
  /** Keep the zoomed image covering the screen edges it can reach */
  const clamp = (v: View): View => {
    const { W, H } = size();
    if (!natural) return v;
    const k = Math.min(W / natural.w, H / natural.h);
    const mx = Math.max(0, (natural.w * k * v.z - W) / 2);
    const my = Math.max(0, (natural.h * k * v.z - H) / 2);
    return { z: v.z, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
  };
  /** Zoom to z keeping the screen point (px, py) still */
  const zoomAt = (from: View, z: number, px: number, py: number): View => {
    const { W, H } = size();
    const qx = px - W / 2;
    const qy = py - H / 2;
    const k = z / from.z;
    return clamp({ z, x: qx - (qx - from.x) * k, y: qy - (qy - from.y) * k });
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: React.PointerEvent) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const p = local(e);
    pts.current.set(e.pointerId, p);
    const s = g.current;
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      g.current = { ...s, kind: 'pinch', v0: view, d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, moved: true };
      setDrag(null);
    } else if (pts.current.size === 1) {
      g.current = { kind: view.z > 1.01 ? 'pan' : 'swipe', sx: p.x, sy: p.y, t: performance.now(), v0: view, d0: 1, mx: 0, my: 0, moved: false };
    }
  };
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    const p = local(e);
    pts.current.set(e.pointerId, p);
    const s = g.current;
    if (s.kind === 'pinch' && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const z = Math.min(6, Math.max(1, s.v0.z * (Math.hypot(b.x - a.x, b.y - a.y) / s.d0)));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const next = zoomAt(s.v0, z, s.mx, s.my);
      setView(clamp({ ...next, x: next.x + (mid.x - s.mx), y: next.y + (mid.y - s.my) }));
      return;
    }
    const dx = p.x - s.sx;
    const dy = p.y - s.sy;
    if (!s.moved && Math.hypot(dx, dy) > 8) s.moved = true;
    if (s.kind === 'pan') setView(clamp({ z: s.v0.z, x: s.v0.x + dx, y: s.v0.y + dy }));
    // Pulling down (not zoomed) previews closing
    if (s.kind === 'swipe' && s.moved && dy > 0 && Math.abs(dy) > Math.abs(dx)) setDrag({ dy });
  };
  const up = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    const p = local(e);
    pts.current.delete(e.pointerId);
    const s = g.current;
    if (s.kind === 'pinch') {
      if (pts.current.size === 0) g.current = { ...s, kind: 'none' };
      if (view.z < 1.05) setView(FIT);
      return;
    }
    const dx = p.x - s.sx;
    const dy = p.y - s.sy;
    const fast = performance.now() - s.t < 600;
    setDrag(null);
    if (s.kind === 'swipe' && s.moved) {
      if (dy > 90 && Math.abs(dy) > Math.abs(dx)) onClose();
      else if (fast && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
      return;
    }
    if (s.moved) return;
    // A tap: double-tap zooms, a single tap shows / hides the controls
    const now = performance.now();
    if (now - lastTap.current < 300) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = 0;
      setView(view.z > 1.01 ? FIT : zoomAt(view, 2.5, p.x, p.y));
      return;
    }
    lastTap.current = now;
    tapTimer.current = window.setTimeout(() => setChrome((c) => !c), 300);
  };

  const pull = drag ? Math.min(1, drag.dy / 300) : 0;

  return (
    <div
      ref={rootRef}
      className="st-fullimg"
      role="dialog"
      aria-label="Image, full screen"
      style={{ background: `rgba(0,0,0,${1 - pull * 0.6})` }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={{
          transform: `translate(${view.x}px, ${view.y + (drag?.dy ?? 0)}px) scale(${view.z * (1 - pull * 0.25)})`,
          transition: g.current.kind === 'none' || (!drag && g.current.kind === 'swipe') ? 'transform .2s ease-out' : 'none',
        }}
      />
      {chrome ? (
        <div className="st-fullimg-bar" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="st-fullimg-btn" onClick={onClose} aria-label="Close full screen">
            <X className="h-5 w-5" />
          </button>
          {counter ? <span className="st-mono text-[13px] text-white/80">{counter}</span> : null}
          <span className="w-10" />
        </div>
      ) : null}
    </div>
  );
}
