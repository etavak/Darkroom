import { Label } from '@/components/ui/label';
import { ScrubbyNumber } from '@/components/ui/scrubby-number';
import { Switch } from '@/components/ui/switch';
import type { HiresFixSettings } from '@/types/generation';

type Props = {
  value: HiresFixSettings;
  onChange: (next: HiresFixSettings) => void;
  disabled?: boolean;
};

export function HiresFixControls({ value, onChange, disabled }: Props) {
  const patch = (partial: Partial<HiresFixSettings>) => onChange({ ...value, ...partial });

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-secondary/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="hires-fix" className="text-xs">
          Hires fix
        </Label>
        <Switch
          id="hires-fix"
          checked={value.enabled}
          onCheckedChange={(v) => patch({ enabled: v })}
          disabled={disabled}
        />
      </div>
      {value.enabled ? (
        <div className="grid grid-cols-3 gap-2">
          <ScrubbyNumber
            id="hires-scale"
            label="Scale"
            value={value.scale}
            onChange={(n) => patch({ scale: n })}
            min={1.1}
            max={4}
            step={0.05}
            defaultValue={1.5}
            disabled={disabled}
          />
          <ScrubbyNumber
            id="hires-steps"
            label="Steps"
            value={value.steps}
            onChange={(n) => patch({ steps: n })}
            min={1}
            max={100}
            step={1}
            defaultValue={15}
            disabled={disabled}
          />
          <ScrubbyNumber
            id="hires-denoise"
            label="Denoise"
            value={value.denoise}
            onChange={(n) => patch({ denoise: n })}
            min={0.05}
            max={1}
            step={0.05}
            defaultValue={0.45}
            disabled={disabled}
          />
        </div>
      ) : null}
    </div>
  );
}
