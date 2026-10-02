import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** Card surface used throughout the controls column. */
export function StCard({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <section className={`st-card ${className}`} style={style}>
      {children}
    </section>
  );
}

/** Quiet uppercase label between groups of cards. */
export function StSection({ children }: { children: ReactNode }) {
  return <div className="st-sec px-1 pt-2.5">{children}</div>;
}

/** Card header row: icon, title + one-line summary, actions on the right. */
export function StCardHead({
  icon,
  title,
  summary,
  actions,
  onClick,
}: {
  icon?: ReactNode;
  title: string;
  summary?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3 pl-4 pr-3">
      {icon ? <span className="st-card-icon">{icon}</span> : null}
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onClick}
        disabled={!onClick}
        style={{ cursor: onClick ? 'pointer' : 'default', background: 'transparent', border: 0, padding: 0, color: 'inherit' }}
      >
        <div className="text-[15px] font-semibold">{title}</div>
        {summary ? (
          <div className="truncate text-[13px]" style={{ color: 'var(--s-muted)' }}>
            {summary}
          </div>
        ) : null}
      </button>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/** Square action button used on card headers. */
export function StCardBtn({
  children,
  label,
  tip,
  onClick,
  disabled,
  active,
}: {
  children: ReactNode;
  label: string;
  tip?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`st-card-btn ${active ? 'on' : ''}`}
      aria-label={label}
      data-tip={tip ?? label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/** On/off switch. */
export function StSwitch({
  on,
  onChange,
  label,
  tip,
  disabled,
  size = 'md',
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  tip?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-tip={tip}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`st-switch ${size} ${on ? 'on' : ''}`}
    >
      <span />
    </button>
  );
}

/**
 * A button that opens a floating menu. Closes on outside click or Esc. The menu is
 * marked data-tip-avoid so tooltips slide past it instead of covering it.
 */
export function StMenuButton({
  button,
  children,
  menuStyle,
  className = '',
  tip,
  label,
  disabled,
  open: openProp,
  onOpenChange,
  direction = 'down',
}: {
  button: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  menuStyle?: CSSProperties;
  className?: string;
  tip?: string;
  label?: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 'auto' opens upward when there isn't room below inside the scrolling column. */
  direction?: 'down' | 'up' | 'auto';
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  };
  const [up, setUp] = useState(direction === 'up');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element;
      // Dropdowns opened from inside the menu render in a portal; clicks there aren't "outside"
      if (t.closest?.('[data-radix-popper-content-wrapper], [role="listbox"], [role="dialog"]')) return;
      if (!rootRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // Esc closes the innermost thing first: a dropdown opened inside the menu handles it itself
      if (e.key === 'Escape' && !document.querySelector('[role="listbox"]')) {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const toggle = () => {
    if (!open && direction === 'auto' && rootRef.current) {
      const r = rootRef.current.getBoundingClientRect();
      const sc = rootRef.current.closest('.st-scroll');
      const bottom = sc ? sc.getBoundingClientRect().bottom : window.innerHeight;
      const top = sc ? sc.getBoundingClientRect().top : 0;
      setUp(bottom - r.bottom < 280 && r.top - top > bottom - r.bottom);
    }
    setOpen(!open);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        aria-disabled={disabled}
        data-tip={open ? undefined : tip}
        onClick={() => !disabled && toggle()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            toggle();
          }
        }}
        style={{ opacity: disabled ? 0.5 : 1 }}
      >
        {button}
      </div>
      {open ? (
        <div
          className="st-menu"
          data-tip-avoid
          style={{ ...(up ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' }), ...menuStyle }}
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      ) : null}
    </div>
  );
}

/** Chip-style face for a menu button: small label over a value, chevron on the right. */
export function StChipFace({ label, value, dot }: { label: string; value: ReactNode; dot?: string }) {
  return (
    <div className="st-chip">
      <span className="flex min-w-0 flex-col items-start leading-[1.15]">
        <span className="text-[11px]" style={{ color: 'var(--s-muted)' }}>
          {label}
        </span>
        <span className="flex max-w-full items-center gap-1.5 truncate font-semibold">
          {dot ? <span className="st-dot" style={{ background: dot }} /> : null}
          <span className="truncate">{value}</span>
        </span>
      </span>
      <ChevronDown className="h-4 w-4 shrink-0" />
    </div>
  );
}

/** Menu row: title + optional detail line, highlighted when selected. */
export function StMenuItem({
  title,
  detail,
  selected,
  onClick,
  right,
}: {
  title: ReactNode;
  detail?: ReactNode;
  selected?: boolean;
  onClick: () => void;
  right?: ReactNode;
}) {
  return (
    <button type="button" className={`st-menu-item ${selected ? 'on' : ''}`} onClick={onClick}>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span className="font-semibold">{title}</span>
        {detail ? (
          <span className="text-left text-xs" style={{ color: 'var(--s-muted)' }}>
            {detail}
          </span>
        ) : null}
      </span>
      {right}
    </button>
  );
}

/** Segmented control. */
export function StSeg<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  small,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; tip?: string; aria?: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`st-seg ${small ? 'sm' : ''}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={o.value === value ? 'on' : ''}
          aria-pressed={o.value === value}
          aria-label={o.aria}
          data-tip={o.tip}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Scrolling middle of the controls column; a divider appears under the top once scrolled. */
export function StScrollArea({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  return (
    <div
      className="st-scroll flex min-h-0 flex-1 flex-col gap-3 px-3.5 pb-5"
      style={{ borderTop: `1px solid ${scrolled ? 'var(--s-line)' : 'transparent'}`, paddingTop: 2 }}
      onScroll={(e) => {
        const on = e.currentTarget.scrollTop > 0;
        if (on !== scrolled) setScrolled(on);
      }}
    >
      {children}
    </div>
  );
}

/** Labelled range slider: value on the right, optional end labels; double-click resets. */
export function StSlider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format = (v) => String(v),
  tip,
  ends,
  resetTo,
  disabled,
  small,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  tip?: string;
  ends?: [string, string];
  resetTo?: number;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5" data-tip={tip}>
      <span className="flex justify-between gap-2">
        <span className="st-lbl text-[13px]">{label}</span>
        <span className={`st-mono font-semibold ${small ? 'text-[13px]' : 'text-sm'}`}>{format(value)}</span>
      </span>
      <input
        className="st-rng"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={resetTo === undefined ? undefined : () => onChange(resetTo)}
      />
      {ends ? (
        <span className="flex justify-between text-[11.5px]" style={{ color: 'var(--s-faint)' }}>
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </span>
      ) : null}
    </label>
  );
}
