import { SAMPLERS, SCHEDULERS } from '@/constants/samplers';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  onStepsChange: (v: number) => void;
  onCfgChange: (v: number) => void;
  onSamplerChange: (v: string) => void;
  onSchedulerChange: (v: string) => void;
  disabled?: boolean;
};

export function SamplerControls({
  steps,
  cfg,
  sampler,
  scheduler,
  onStepsChange,
  onCfgChange,
  onSamplerChange,
  onSchedulerChange,
  disabled,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="steps">Steps</Label>
          <Input
            id="steps"
            type="number"
            min={1}
            max={150}
            className="font-mono"
            value={steps}
            onChange={(e) => onStepsChange(Number(e.target.value))}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cfg">CFG</Label>
          <Input
            id="cfg"
            type="number"
            min={1}
            max={30}
            step={0.5}
            className="font-mono"
            value={cfg}
            onChange={(e) => onCfgChange(Number(e.target.value))}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Sampler</Label>
        <Select value={sampler} onValueChange={onSamplerChange} disabled={disabled}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SAMPLERS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Scheduler</Label>
        <Select value={scheduler} onValueChange={onSchedulerChange} disabled={disabled}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCHEDULERS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
