import type { AspectPreset } from '@/types/presets';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Props = {
  presets: AspectPreset[];
  width: number;
  height: number;
  onChange: (width: number, height: number) => void;
  disabled?: boolean;
};

function AspectIcon({ w, h, active }: { w: number; h: number; active: boolean }) {
  const max = 14;
  const scale = max / Math.max(w, h);
  const iw = Math.max(4, Math.round(w * scale));
  const ih = Math.max(4, Math.round(h * scale));
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block rounded-[2px] border',
        active ? 'border-primary-foreground/80 bg-primary-foreground/25' : 'border-muted-foreground/70',
      )}
      style={{ width: iw, height: ih }}
    />
  );
}

export function AspectRatioPresets({ presets, width, height, onChange, disabled }: Props) {
  return (
    <div className="space-y-1.5">
      <Label>Aspect ratio</Label>
      <div className="grid grid-cols-4 gap-1.5">
        {presets.map((preset, index) => {
          const active = preset.width === width && preset.height === height;
          const isSecondRow = index >= 4;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(preset.width, preset.height)}
              className={cn(
                'flex h-12 flex-col items-center justify-center gap-1 rounded-md border text-[11px] font-medium transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground',
                disabled && 'pointer-events-none opacity-50',
                isSecondRow && index === 4 && 'col-start-1',
              )}
            >
              <AspectIcon w={preset.width} h={preset.height} active={active} />
              {preset.label}
            </button>
          );
        })}
      </div>
      <p className="font-mono text-[11px] text-muted-foreground">
        {width} × {height}
      </p>
    </div>
  );
}
