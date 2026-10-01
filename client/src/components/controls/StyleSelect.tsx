import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { FamilyStyleSummary } from '@/types/presets';

type Props = {
  styles: FamilyStyleSummary[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** When false, the whole Style control is hidden. */
  visible?: boolean;
};

export function StyleSelect({ styles, value, onChange, disabled, visible = true }: Props) {
  if (!visible || styles.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <Label>Style</Label>
      <div className="flex flex-wrap gap-1.5">
        {styles.map((s) => {
          const active = s.id === value;
          return (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(s.id)}
              className={cn(
                'rounded-[10px] border px-3 py-1 text-xs font-medium transition-colors duration-150',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground',
                disabled && 'pointer-events-none opacity-50',
              )}
            >
              {s.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
