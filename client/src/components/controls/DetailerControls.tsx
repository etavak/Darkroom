import { Label } from '@/components/ui/label';
import { ScrubbyNumber } from '@/components/ui/scrubby-number';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { DetailerSettings } from '@/types/generation';

export const DEFAULT_DETAILER: DetailerSettings = {
  enabled: false,
  guide_size: 512,
  steps: 12,
  denoise: 0.4,
  detector: 'bbox/face_yolov8m.pt',
};

type Props = {
  value: DetailerSettings;
  onChange: (next: DetailerSettings) => void;
  detectors: string[];
  available: boolean;
  disabled?: boolean;
};

export function DetailerControls({
  value,
  onChange,
  detectors,
  available,
  disabled,
}: Props) {
  const patch = (partial: Partial<DetailerSettings>) => onChange({ ...value, ...partial });
  const gated = disabled || !available;
  const detectorOptions =
    detectors.length > 0
      ? detectors
      : [value.detector || 'bbox/face_yolov8m.pt'].filter(Boolean);

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-secondary/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="detailer-on" className="text-xs">
          Face detailer
        </Label>
        <Switch
          id="detailer-on"
          checked={value.enabled && available}
          onCheckedChange={(v) => patch({ enabled: v })}
          disabled={gated}
        />
      </div>

      {!available ? (
        <p className="text-[10px] text-muted-foreground">
          Install Impact Pack (Components → Custom nodes) to enable FaceDetailer.
        </p>
      ) : null}

      {value.enabled && available ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Detector</Label>
            <Select
              value={value.detector || detectorOptions[0]}
              onValueChange={(v) => patch({ detector: v })}
              disabled={gated}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {detectorOptions.map((d) => (
                  <SelectItem key={d} value={d} className="text-xs">
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ScrubbyNumber
              id="detailer-denoise"
              label="Denoise"
              value={value.denoise ?? 0.4}
              onChange={(n) => patch({ denoise: n })}
              min={0.05}
              max={1}
              step={0.05}
              defaultValue={0.4}
              disabled={gated}
            />
            <ScrubbyNumber
              id="detailer-steps"
              label="Steps"
              value={value.steps ?? 12}
              onChange={(n) => patch({ steps: n })}
              min={1}
              max={50}
              step={1}
              defaultValue={12}
              disabled={gated}
            />
            <ScrubbyNumber
              id="detailer-guide"
              label="Guide"
              value={value.guide_size ?? 512}
              onChange={(n) => patch({ guide_size: n })}
              min={256}
              max={1024}
              step={64}
              defaultValue={512}
              disabled={gated}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
