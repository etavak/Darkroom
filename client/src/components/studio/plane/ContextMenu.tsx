import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type CtxItem = { label: string; hint?: string; danger?: boolean; disabled?: boolean; onClick: () => void } | 'sep';

/** Right-click menu at the pointer, kept on screen. Closes on outside click, Esc or scroll. */
export function ContextMenu({ x, y, items, onClose, label = 'Image actions' }: { x: number; y: number; items: CtxItem[]; onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', onClose, { passive: true });
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('wheel', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="st-menu"
      data-tip-avoid
      role="menu"
      aria-label={label}
      style={{ position: 'fixed', left: pos.x, top: pos.y, width: 236, zIndex: 150 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={`sep-${i}`} className="mx-1.5 my-1 h-px" style={{ background: 'var(--s-line)' }} />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            className="st-menu-item flex-row items-center justify-between"
            disabled={it.disabled}
            style={{ color: it.danger ? '#f0857f' : undefined, opacity: it.disabled ? 0.45 : 1 }}
            onClick={() => {
              onClose();
              it.onClick();
            }}
          >
            <span>{it.label}</span>
            {it.hint ? (
              <span className="st-mono text-[11.5px]" style={{ color: 'var(--s-faint)' }}>
                {it.hint}
              </span>
            ) : null}
          </button>
        ),
      )}
    </div>
  );
}
