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
  guidance?: number;
  clipSkip?: number;
  defaults?: {
    steps?: number;
    cfg?: number;
    sampler?: string;
    scheduler?: string;
    guidance?: number;
    clipSkip?: number;
  };
  showGuidance?: boolean;
  showClipSkip?: boolean;
  onStepsChange: (v: number) => void;
  onCfgChange: (v: number) => void;
  onSamplerChange: (v: string) => void;
  onSchedulerChange: (v: string) => void;
  onGuidanceChange?: (v: number) => void;
  onClipSkipChange?: (v: number) => void;
  disabled?: boolean;
};

export function SamplerControls({
  steps,
  cfg,
  sampler,
  scheduler,
  guidance,
  clipSkip,
  defaults,
  showGuidance,
  showClipSkip,
  onStepsChange,
  onCfgChange,
  onSamplerChange,
  onSchedulerChange,
  onGuidanceChange,
  onClipSkipChange,
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
          defaultValue={defaults?.steps ?? 25}
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
          defaultValue={defaults?.cfg ?? 7}
          disabled={disabled}
        />
      </div>

      {(showGuidance || showClipSkip) && (
        <div className="grid grid-cols-2 gap-2">
          {showGuidance && typeof guidance === 'number' && onGuidanceChange ? (
            <ScrubbyNumber
              id="guidance"
              label="Guidance"
              value={guidance}
              onChange={onGuidanceChange}
              min={0}
              max={20}
              step={0.1}
              defaultValue={defaults?.guidance ?? 3.5}
              disabled={disabled}
            />
          ) : (
            <div />
          )}
          {showClipSkip && typeof clipSkip === 'number' && onClipSkipChange ? (
            <ScrubbyNumber
              id="clip-skip"
              label="CLIP skip"
              value={clipSkip}
              onChange={onClipSkipChange}
              min={1}
              max={12}
              step={1}
              defaultValue={defaults?.clipSkip ?? 2}
              disabled={disabled}
            />
          ) : null}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label>Sampler</Label>
          {defaults?.sampler && sampler !== defaults.sampler ? (
            <button
              type="button"
              className="h-2 w-2 shrink-0 rounded-full bg-primary ring-1 ring-primary/40"
              title={`Reset to ${defaults.sampler}`}
              aria-label="Reset sampler to default"
              disabled={disabled}
              onClick={() => onSamplerChange(defaults.sampler!)}
            />
          ) : null}
        </div>
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
        <div className="flex items-center gap-1.5">
          <Label>Scheduler</Label>
          {defaults?.scheduler && scheduler !== defaults.scheduler ? (
            <button
              type="button"
              className="h-2 w-2 shrink-0 rounded-full bg-primary ring-1 ring-primary/40"
              title={`Reset to ${defaults.scheduler}`}
              aria-label="Reset scheduler to default"
              disabled={disabled}
              onClick={() => onSchedulerChange(defaults.scheduler!)}
            />
          ) : null}
        </div>
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
