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
  /** Restored on double-click of the label or click of the reset dot. */
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
  const scale = shift ? 10 : alt ? 0.1 : 1;
  return (dx / 4) * step * scale;
}

function effectiveStep(step: number, shift: boolean, alt: boolean): number {
  if (shift) return step * 10;
  if (alt) return Math.max(step / 10, 0.01);
  return step;
}

function nearlyEqual(a: number, b: number, step: number): boolean {
  const eps = Math.max(step / 2, 1e-6);
  return Math.abs(a - b) <= eps;
}

/**
 * Photoshop-style number field: drag left/right on the label to scrub.
 * Shift = 10× step, Alt = fine, double-click label = reset to default.
 * A small dot appears when the value differs from the family default.
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

  const dirty =
    defaultValue !== undefined && !nearlyEqual(value, defaultValue, step);

  const reset = () => {
    if (disabled || defaultValue === undefined) return;
    onChange(clamp(defaultValue, min, max));
  };

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
      <div className="flex items-center gap-1.5">
        <Label
          htmlFor={id}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={reset}
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
        {dirty ? (
          <button
            type="button"
            className="h-2 w-2 shrink-0 rounded-full bg-primary shadow-[0_0_0_2px_oklch(0.145_0_0)] ring-1 ring-primary/40"
            title={`Reset to ${defaultValue}`}
            aria-label={`Reset ${label} to default`}
            disabled={disabled}
            onClick={reset}
          />
        ) : null}
      </div>
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
