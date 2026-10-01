import { useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Props = {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  disabled?: boolean;
  className?: string;
  /** Extra controls rendered to the right of the stepper field (lock, dice, …). */
  trailing?: React.ReactNode;
  integer?: boolean;
};

function clamp(n: number, min?: number, max?: number): number {
  let v = n;
  if (typeof min === 'number') v = Math.max(min, v);
  if (typeof max === 'number') v = Math.min(max, v);
  return v;
}

/**
 * Themed number field with up/down steppers and a scrubby label.
 * Shift = 10×, Alt = fine, double-click label resets to default.
 */
export function StepperNumber({
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
  trailing,
  integer = true,
}: Props) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startValue = useRef(0);

  const commit = (n: number) => {
    const snapped = integer ? Math.trunc(n) : n;
    onChange(clamp(snapped, min, max));
  };

  const bump = (dir: 1 | -1) => {
    if (disabled) return;
    commit(value + dir * step);
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label
        htmlFor={id}
        className={cn('select-none', disabled ? 'cursor-default' : 'cursor-ew-resize')}
        title={
          defaultValue !== undefined
            ? 'Drag to adjust · Shift 10× · Alt fine · Double-click reset'
            : 'Drag to adjust · Shift 10× · Alt fine'
        }
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.preventDefault();
          dragging.current = true;
          startX.current = e.clientX;
          startValue.current = value;
          e.currentTarget.setPointerCapture(e.pointerId);
          document.body.style.cursor = 'ew-resize';
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          let scale = 1;
          if (e.shiftKey) scale = 10;
          else if (e.altKey) scale = 0.1;
          const delta = ((e.clientX - startX.current) / 4) * step * scale;
          const raw = startValue.current + delta;
          commit(integer ? Math.round(raw) : Math.round(raw / step) * step);
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* noop */
          }
          document.body.style.cursor = '';
        }}
        onPointerCancel={() => {
          dragging.current = false;
          document.body.style.cursor = '';
        }}
        onDoubleClick={() => {
          if (disabled || defaultValue === undefined) return;
          commit(defaultValue);
        }}
      >
        {label}
      </Label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            id={id}
            type="text"
            inputMode="numeric"
          className="pr-8 font-mono tabular-nums"
            value={value}
            disabled={disabled}
            onChange={(e) => {
              const raw = e.target.value.replace(integer ? /[^\d-]/g : /[^\d.-]/g, '');
              if (raw === '' || raw === '-') {
                if (typeof min === 'number') commit(min);
                return;
              }
              const n = Number(raw);
              if (!Number.isFinite(n)) return;
              commit(n);
            }}
          />
          <div className="absolute inset-y-0 right-0 flex w-7 flex-col border-l border-input">
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled || (typeof max === 'number' && value >= max)}
              className="flex flex-1 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground disabled:opacity-40"
              aria-label={`Increase ${label}`}
              onClick={() => bump(1)}
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled || (typeof min === 'number' && value <= min)}
              className="flex flex-1 items-center justify-center border-t border-input text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground disabled:opacity-40"
              aria-label={`Decrease ${label}`}
              onClick={() => bump(-1)}
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        </div>
        {trailing}
      </div>
    </div>
  );
}
