import { ArrowLeftRight } from 'lucide-react';
import { useState } from 'react';
import type { AspectPreset } from '@/types/presets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { round64 } from '@/constants/aspectRatios';

type Props = {
  presets: AspectPreset[];
  width: number;
  height: number;
  aspectId: string;
  onChange: (width: number, height: number, aspectId: string) => void;
  disabled?: boolean;
};

function AspectIcon({ w, h, active }: { w: number; h: number; active: boolean }) {
  const max = 14;
  const scale = max / Math.max(w, h, 1);
  const iw = Math.max(4, Math.round(w * scale));
  const ih = Math.max(4, Math.round(h * scale));
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block rounded-[2px] border',
        active ? 'border-primary bg-primary/40' : 'border-muted-foreground/70',
      )}
      style={{ width: iw, height: ih }}
    />
  );
}

export function AspectRatioPresets({
  presets,
  width,
  height,
  aspectId,
  onChange,
  disabled,
}: Props) {
  const [customOpen, setCustomOpen] = useState(aspectId === 'custom');
  const isCustom = aspectId === 'custom' || !presets.some((p) => p.id === aspectId);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>Aspect ratio</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[11px]"
          disabled={disabled || width === height}
          onClick={() => onChange(height, width, isCustom ? 'custom' : aspectId)}
          title="Swap portrait / landscape"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Swap
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {presets.map((preset) => {
          const active =
            !isCustom &&
            ((preset.id === aspectId && aspectId !== 'custom') ||
              (preset.width === width && preset.height === height));
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                setCustomOpen(false);
                onChange(preset.width, preset.height, preset.id);
              }}
              className={cn(
                'flex h-12 flex-col items-center justify-center gap-1 rounded-[10px] border text-[11px] font-medium transition-colors duration-150',
                active
                  ? 'border-primary bg-primary/15 text-foreground'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground',
                disabled && 'pointer-events-none opacity-50',
              )}
            >
              <AspectIcon w={preset.width} h={preset.height} active={Boolean(active)} />
              {preset.label}
            </button>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setCustomOpen(true);
            onChange(width, height, 'custom');
          }}
          className={cn(
            'flex h-12 flex-col items-center justify-center gap-1 rounded-[10px] border text-[11px] font-medium transition-colors duration-150',
            isCustom || customOpen
              ? 'border-primary bg-primary/15 text-foreground'
              : 'border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground',
            disabled && 'pointer-events-none opacity-50',
          )}
        >
          <span className="text-sm leading-none">+</span>
          Custom
        </button>
      </div>
      {(isCustom || customOpen) && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            className="h-8 font-mono text-xs"
            value={width}
            disabled={disabled}
            onChange={(e) => onChange(round64(Number(e.target.value) || 64), height, 'custom')}
          />
          <span className="text-xs text-muted-foreground">×</span>
          <Input
            type="number"
            className="h-8 font-mono text-xs"
            value={height}
            disabled={disabled}
            onChange={(e) => onChange(width, round64(Number(e.target.value) || 64), 'custom')}
          />
        </div>
      )}
      <p className="font-mono text-[11px] text-muted-foreground">
        {width} × {height}
      </p>
    </div>
  );
}
