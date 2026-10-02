import { useCallback, useRef, useState } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
import type { ControlNetSettings } from '@/types/generation';

export type ControlNetUiState = {
  enabled: boolean;
  name: string;
  image: string;
  previewUrl: string | null;
  strength: number;
  start_percent: number;
  end_percent: number;
  preprocessor: 'none' | 'canny' | 'depth' | 'openpose';
};

export const DEFAULT_CONTROLNET_UI: ControlNetUiState = {
  enabled: false,
  name: '',
  image: '',
  previewUrl: null,
  strength: 1,
  start_percent: 0,
  end_percent: 1,
  preprocessor: 'none',
};

export function controlNetPayload(ui: ControlNetUiState): ControlNetSettings | null {
  if (!ui.enabled || !ui.name || !ui.image) return null;
  return {
    name: ui.name,
    image: ui.image,
    strength: ui.strength,
    start_percent: ui.start_percent,
    end_percent: ui.end_percent,
    preprocessor: ui.preprocessor === 'none' ? undefined : ui.preprocessor,
  };
}

type Props = {
  value: ControlNetUiState;
  onChange: (next: ControlNetUiState) => void;
  models: string[];
  controlnetAvailable: boolean;
  auxAvailable: boolean;
  disabled?: boolean;
  onUploadImage: (file: File) => Promise<{ comfyName: string; previewUrl: string }>;
};

export function ControlNetPanel({
  value,
  onChange,
  models,
  controlnetAvailable,
  auxAvailable,
  disabled,
  onUploadImage,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const patch = (partial: Partial<ControlNetUiState>) => onChange({ ...value, ...partial });

  const onFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file || !file.type.startsWith('image/')) return;
      setUploading(true);
      try {
        const res = await onUploadImage(file);
        patch({ image: res.comfyName, previewUrl: res.previewUrl, enabled: true });
      } finally {
        setUploading(false);
      }
    },
    // patch closes over value — intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onUploadImage, value],
  );

  const gated = disabled || !controlnetAvailable;

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-secondary/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="controlnet-on" className="text-xs">
          ControlNet
        </Label>
        <Switch
          id="controlnet-on"
          checked={value.enabled}
          onCheckedChange={(v) => patch({ enabled: v })}
          disabled={gated}
        />
      </div>

      {!controlnetAvailable ? (
        <p className="text-[10px] text-muted-foreground">
          ControlNetLoader not found in ComfyUI. Install a ControlNet-capable build / nodes.
        </p>
      ) : null}

      {value.enabled && controlnetAvailable ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Model</Label>
            <Select
              value={value.name || undefined}
              onValueChange={(v) => patch({ name: v })}
              disabled={gated || models.length === 0}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue
                  placeholder={models.length ? 'Select ControlNet…' : 'No ControlNet models'}
                />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Reference image</Label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <div
              className={cn(
                'flex items-center gap-2 rounded-md border border-dashed p-2',
                dragOver ? 'border-primary bg-primary/5' : 'border-border',
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void onFile(e.dataTransfer.files?.[0]);
              }}
            >
              {value.previewUrl ? (
                <img
                  src={value.previewUrl}
                  alt=""
                  className="h-12 w-12 rounded object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded bg-secondary">
                  <ImagePlus className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] text-muted-foreground">
                  {value.image || 'Drop or upload an image'}
                </p>
                <div className="mt-1 flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[11px]"
                    disabled={gated || uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="mr-1 h-3 w-3" />
                    {uploading ? 'Uploading…' : 'Upload'}
                  </Button>
                  {value.image ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px]"
                      disabled={gated}
                      onClick={() => patch({ image: '', previewUrl: null })}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Preprocessor</Label>
            <Select
              value={value.preprocessor}
              onValueChange={(v) =>
                patch({ preprocessor: v as ControlNetUiState['preprocessor'] })
              }
              disabled={gated || (!auxAvailable && value.preprocessor === 'none')}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">
                  None (raw image)
                </SelectItem>
                <SelectItem value="canny" className="text-xs" disabled={!auxAvailable}>
                  Canny
                </SelectItem>
                <SelectItem value="depth" className="text-xs" disabled={!auxAvailable}>
                  Depth
                </SelectItem>
                <SelectItem value="openpose" className="text-xs" disabled={!auxAvailable}>
                  OpenPose
                </SelectItem>
              </SelectContent>
            </Select>
            {!auxAvailable ? (
              <p className="text-[10px] text-muted-foreground">
                Install ControlNet Aux for preprocessors (Components → Custom nodes).
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <ScrubbyNumber
              id="cn-strength"
              label="Strength"
              value={value.strength}
              onChange={(n) => patch({ strength: n })}
              min={0}
              max={2}
              step={0.05}
              defaultValue={1}
              disabled={gated}
            />
            <ScrubbyNumber
              id="cn-start"
              label="Start"
              value={value.start_percent}
              onChange={(n) => patch({ start_percent: n })}
              min={0}
              max={1}
              step={0.05}
              defaultValue={0}
              disabled={gated}
            />
            <ScrubbyNumber
              id="cn-end"
              label="End"
              value={value.end_percent}
              onChange={(n) => patch({ end_percent: n })}
              min={0}
              max={1}
              step={0.05}
              defaultValue={1}
              disabled={gated}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
