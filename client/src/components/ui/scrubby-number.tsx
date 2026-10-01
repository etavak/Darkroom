import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type ScrubbyNumberProps = {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Base step for typing and scrubbing (default 1). */
  step?: number;
  /** Restored on double-click of the label. */
  defaultValue?: number;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  suffix?: string;
};

function clamp(n: number, min?: number, max?: number): number {
  let v = n;
  if (typeof min === 'number') v = Math.max(min, v);
  if (typeof max === 'number') v = Math.min(max, v);
  return v;
}

function roundToStep(n: number, step: number): number {
  if (step <= 0) return n;
  const decimals = Math.min(6, (String(step).split('.')[1] ?? '').length);
  const rounded = Math.round(n / step) * step;
  return Number(rounded.toFixed(Math.max(decimals, 0)));
}

function scrubDelta(dx: number, step: number, shift: boolean, alt: boolean): number {
  // ~4px per base unit; Shift = 10×, Alt = fine (0.1×)
  const scale = shift ? 10 : alt ? 0.1 : 1;
  return (dx / 4) * step * scale;
}

function effectiveStep(step: number, shift: boolean, alt: boolean): number {
  if (shift) return step * 10;
  if (alt) return Math.max(step / 10, 0.01);
  return step;
}

/**
 * Photoshop-style number field: drag left/right on the label to scrub.
 * Shift = 10× step, Alt = fine, double-click label = reset to default.
 */
export function ScrubbyNumber({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  defaultValue,
  disabled,
  className,
  inputClassName,
  suffix,
}: ScrubbyNumberProps) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startValue = useRef(0);

  const onPointerDown = (e: React.PointerEvent<HTMLLabelElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startValue.current = value;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'ew-resize';
  };

  const onPointerMove = (e: React.PointerEvent<HTMLLabelElement>) => {
    if (!dragging.current) return;
    const raw = startValue.current + scrubDelta(e.clientX - startX.current, step, e.shiftKey, e.altKey);
    const snapped = roundToStep(raw, effectiveStep(step, e.shiftKey, e.altKey));
    onChange(clamp(snapped, min, max));
  };

  const endDrag = (e: React.PointerEvent<HTMLLabelElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    document.body.style.cursor = '';
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label
        htmlFor={id}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          if (disabled || defaultValue === undefined) return;
          onChange(clamp(defaultValue, min, max));
        }}
        className={cn(
          'select-none',
          disabled ? 'cursor-default opacity-50' : 'cursor-ew-resize',
        )}
        title={
          defaultValue !== undefined
            ? 'Drag to adjust · Shift 10× · Alt fine · Double-click reset'
            : 'Drag to adjust · Shift 10× · Alt fine'
        }
      >
        {label}
      </Label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          type="text"
          inputMode={step < 1 ? 'decimal' : 'numeric'}
          min={min}
          max={max}
          step={step}
          className={cn('font-mono tabular-nums', inputClassName)}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '' || raw === '-' || raw === '.') return;
            const n = Number(raw);
            if (!Number.isFinite(n)) return;
            onChange(clamp(n, min, max));
          }}
        />
        {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
