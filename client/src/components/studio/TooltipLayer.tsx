import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

type Tip = { text: string; x: number; y: number; transform: string };

const TIP_SELECTOR = '[data-tip], [title], button[aria-label], [role="button"][aria-label]';

/**
 * The element to show a tip for, and its text: `data-tip`, a native `title` (moved to
 * data-tip so the browser's own tooltip doesn't double up), or an icon-only button's label.
 */
function tipTarget(from: EventTarget | null): Element | null {
  const el = (from as Element | null)?.closest?.(TIP_SELECTOR);
  if (!el) return null;
  // data-tip="" opts out (e.g. image tiles, whose label is for screen readers only)
  if (el.hasAttribute('data-tip')) return el.getAttribute('data-tip') ? el : null;
  const title = el.getAttribute('title');
  if (title) {
    el.setAttribute('data-tip', title);
    el.removeAttribute('title');
    return el;
  }
  const label = el.getAttribute('aria-label');
  // Buttons that show their own text don't need a tip
  if (label && !(el.textContent ?? '').trim()) {
    el.setAttribute('data-tip', label);
    return el;
  }
  return el.parentElement ? tipTarget(el.parentElement) : null;
}
type Side = 'right' | 'left' | 'above' | 'below';

const GAP = 10;
const TIP_W = 240;
const TIP_H = 44;

/**
 * One tooltip layer for the studio. Any element with `data-tip` gets a tooltip that is
 * placed *outside* the panel or toolbar it lives in (`data-tip-zone="right|left|above|below"`
 * on that container) and slides past open menus and pop-outs (`data-tip-avoid`), so a
 * tooltip never covers the thing it describes or anything that is open. Clicking hides it
 * until the pointer leaves; keyboard focus shows it immediately.
 */
export function TooltipRoot({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const current = useRef<Element | null>(null);
  const muted = useRef<Element | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hiddenAt = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const hide = useCallback(() => {
    setTip((t) => {
      if (t) hiddenAt.current = performance.now();
      return null;
    });
  }, []);

  const show = useCallback((el: Element) => {
    const root = rootRef.current;
    const text = el.getAttribute('data-tip');
    if (!root || !text || !el.isConnected || !root.contains(el)) return;
    const rr = root.getBoundingClientRect();
    const f = rr.width / root.clientWidth || 1;
    const local = (x: number, y: number) => ({ x: (x - rr.left) / f, y: (y - rr.top) / f });
    const r = el.getBoundingClientRect();
    const zoneEl = el.closest('[data-tip-zone]');
    // No zone: open toward the roomier side (above in the lower half, below in the upper)
    const fallback: Side = r.top - rr.top > rr.height / 2 ? 'above' : 'below';
    const side = (zoneEl?.getAttribute('data-tip-zone') as Side | null) ?? fallback;
    const z = zoneEl ? zoneEl.getBoundingClientRect() : r;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const pos =
      side === 'right'
        ? local(z.right + GAP * f, cy)
        : side === 'left'
          ? local(z.left - GAP * f, cy)
          : side === 'above'
            ? local(cx, z.top - GAP * f)
            : local(cx, z.bottom + GAP * f);
    if (side === 'right' || side === 'left') {
      // Slide past anything open (menus, pop-out panels) that sits where the tip would go
      for (let pass = 0; pass < 3; pass++) {
        root.querySelectorAll('[data-tip-avoid]').forEach((a) => {
          if (a.contains(el)) return;
          const ar = a.getBoundingClientRect();
          const tl = local(ar.left, ar.top);
          const br = local(ar.right, ar.bottom);
          if (pos.y + TIP_H / 2 < tl.y || pos.y - TIP_H / 2 > br.y) return;
          if (side === 'right' && tl.x < pos.x + TIP_W && br.x > pos.x) pos.x = br.x + GAP;
          if (side === 'left' && br.x > pos.x - TIP_W && tl.x < pos.x) pos.x = tl.x - GAP;
        });
      }
      pos.y = Math.min(root.clientHeight - TIP_H / 2 - 8, Math.max(TIP_H / 2 + 8, pos.y));
    } else {
      pos.x = Math.min(root.clientWidth - TIP_W / 2 - 8, Math.max(TIP_W / 2 + 8, pos.x));
    }
    const transform = {
      right: 'translateY(-50%)',
      left: 'translate(-100%, -50%)',
      above: 'translate(-50%, -100%)',
      below: 'translateX(-50%)',
    }[side];
    setTip({ text, x: Math.round(pos.x), y: Math.round(pos.y), transform });
  }, []);

  const onPointerOver = (e: PointerEvent) => {
    const el = tipTarget(e.target);
    if (!el || el === current.current) return;
    current.current = el;
    window.clearTimeout(timer.current);
    if (el === muted.current || document.body.dataset.stDragging) return;
    const quick = performance.now() - hiddenAt.current < 400;
    timer.current = window.setTimeout(() => show(el), quick ? 40 : 420);
  };
  const onPointerOut = (e: PointerEvent) => {
    const to = e.relatedTarget as Node | null;
    if (current.current && to && current.current.contains(to)) return;
    window.clearTimeout(timer.current);
    current.current = null;
    muted.current = null;
    hide();
  };
  const onPointerDown = () => {
    window.clearTimeout(timer.current);
    muted.current = current.current;
    hide();
  };
  const onFocus = (e: FocusEvent) => {
    const el = tipTarget(e.target);
    if (el && el.matches(':focus-visible')) {
      current.current = el;
      show(el);
    }
  };

  return (
    <div
      ref={rootRef}
      className={className}
      style={style}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
      onBlur={() => hide()}
    >
      {children}
      {tip ? (
        <div className="st-tip" role="tooltip" style={{ left: tip.x, top: tip.y, transform: tip.transform }}>
          {tip.text}
        </div>
      ) : null}
    </div>
  );
}
