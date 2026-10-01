import { SAMPLERS, SCHEDULERS } from '@/constants/samplers';
import { Label } from '@/components/ui/label';
import { ScrubbyNumber } from '@/components/ui/scrubby-number';
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
        <ScrubbyNumber
          id="steps"
          label="Steps"
          value={steps}
          onChange={onStepsChange}
          min={1}
          max={150}
          step={1}
          defaultValue={25}
          disabled={disabled}
        />
        <ScrubbyNumber
          id="cfg"
          label="CFG"
          value={cfg}
          onChange={onCfgChange}
          min={1}
          max={30}
          step={0.5}
          defaultValue={7}
          disabled={disabled}
        />
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
