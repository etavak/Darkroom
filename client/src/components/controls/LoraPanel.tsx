import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ModelSelect } from '@/components/controls/ModelSelect';
import { StepperNumber } from '@/components/ui/stepper-number';
import type { LoraSettings } from '@/types/generation';

type Props = {
  loras: LoraSettings[];
  options: string[];
  onChange: (loras: LoraSettings[]) => void;
  loading?: boolean;
  disabled?: boolean;
  offline?: boolean;
  onAddModel?: () => void;
};

export function LoraPanel({
  loras,
  options,
  onChange,
  loading,
  disabled,
  offline,
  onAddModel,
}: Props) {
  const add = () => {
    if (options.length === 0) return;
    onChange([
      ...loras,
      { name: options[0], strength_model: 1, strength_clip: 1 },
    ]);
  };

  const update = (index: number, patch: Partial<LoraSettings>) => {
    onChange(loras.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const remove = (index: number) => {
    onChange(loras.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-muted-foreground">LoRAs</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={add}
          disabled={disabled || offline || loading || options.length === 0 || loras.length >= 8}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      {options.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No LoRAs in models/loras</p>
      ) : null}
      {loras.map((lora, index) => (
        <div
          key={`${lora.name}-${index}`}
          className="flex flex-col gap-2 rounded-[10px] border border-border/80 bg-secondary/20 p-2.5"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ModelSelect
                label={`LoRA ${index + 1}`}
                options={options}
                value={lora.name}
                onChange={(name) => update(index, { name })}
                loading={loading}
                disabled={disabled}
                offline={offline}
                onAddModel={onAddModel}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-6 h-8 w-8 shrink-0 text-muted-foreground"
              onClick={() => remove(index)}
              disabled={disabled}
              aria-label="Remove LoRA"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StepperNumber
              id={`lora-model-${index}`}
              label="Model strength"
              value={lora.strength_model}
              onChange={(v) => update(index, { strength_model: v })}
              min={-2}
              max={2}
              step={0.05}
              disabled={disabled}
            />
            <StepperNumber
              id={`lora-clip-${index}`}
              label="CLIP strength"
              value={lora.strength_clip}
              onChange={(v) => update(index, { strength_clip: v })}
              min={-2}
              max={2}
              step={0.05}
              disabled={disabled}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
