import { useCallback, useRef, useState } from 'react';
import { ImagePlus, Replace, Trash2, Upload } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { padsForAspect } from '@/lib/sourceImage';
import type {
  OutpaintSettings,
  SourceFitMode,
  SourceImageState,
  SourceSizeMode,
  WorkMode,
} from '@/types/generation';

type Props = {
  source: SourceImageState | null;
  mode: WorkMode;
  supportsEdit: boolean;
  denoise: number;
  sourceSizeMode: SourceSizeMode;
  sourceFit: SourceFitMode;
  outpaint: OutpaintSettings;
  disabled?: boolean;
  onModeChange: (mode: WorkMode) => void;
  onClear: () => void;
  onReplaceFile: (file: File) => void;
  onDenoiseChange: (v: number) => void;
  onSourceSizeModeChange: (v: SourceSizeMode) => void;
  onSourceFitChange: (v: SourceFitMode) => void;
  onOutpaintChange: (v: OutpaintSettings) => void;
};

const MODES: Array<{ id: WorkMode; label: string; needsSource: boolean; editOnly?: boolean }> = [
  { id: 'generate', label: 'Generate', needsSource: false },
  { id: 'img2img', label: 'img2img', needsSource: true },
  { id: 'outpaint', label: 'Outpaint', needsSource: true },
  { id: 'edit', label: 'Edit', needsSource: true, editOnly: true },
];

export function SourcePanel({
  source,
  mode,
  supportsEdit,
  denoise,
  sourceSizeMode,
  sourceFit,
  outpaint,
  disabled,
  onModeChange,
  onClear,
  onReplaceFile,
  onDenoiseChange,
  onSourceSizeModeChange,
  onSourceFitChange,
  onOutpaintChange,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const onFile = useCallback(
    (file: File | undefined | null) => {
      if (!file || !file.type.startsWith('image/')) return;
      onReplaceFile(file);
    },
    [onReplaceFile],
  );

  const patchOutpaint = (partial: Partial<OutpaintSettings>) =>
    onOutpaintChange({ ...outpaint, ...partial });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {MODES.filter((m) => !m.editOnly || supportsEdit).map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={disabled || (m.needsSource && !source && m.id !== 'img2img')}
            onClick={() => onModeChange(m.id)}
            className={cn(
              'rounded-[8px] border px-2.5 py-1 text-[11px] font-medium transition-colors',
              mode === m.id
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
              disabled && 'opacity-50',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.currentTarget.value = '';
        }}
      />

      {source ? (
        <div className="flex items-start gap-3">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
            <img src={source.previewUrl} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {source.width && source.height
                ? `${source.width}×${source.height}`
                : source.localName}
            </p>
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                disabled={disabled}
                onClick={() => fileRef.current?.click()}
              >
                <Replace className="h-3.5 w-3.5" />
                Replace
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                disabled={disabled}
                onClick={onClear}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-6 text-center transition-colors',
            dragOver ? 'border-primary bg-primary/10' : 'border-border bg-secondary/20',
            disabled && 'opacity-50',
          )}
        >
          <Upload className="h-4 w-4 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">
            Drop, paste (Ctrl+V), or browse
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] text-primary">
            <ImagePlus className="h-3 w-3" />
            Set source image
          </span>
        </button>
      )}

      {mode === 'img2img' && source ? (
        <div className="space-y-2 rounded-md border border-border/60 bg-secondary/20 p-2.5">
          <ScrubbyNumber
            id="img2img-denoise"
            label="Denoise"
            value={denoise}
            onChange={onDenoiseChange}
            min={0}
            max={1}
            step={0.05}
            defaultValue={0.55}
            disabled={disabled}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">Size</Label>
              <Select
                value={sourceSizeMode}
                onValueChange={(v) => onSourceSizeModeChange(v as SourceSizeMode)}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="match">Match source</SelectItem>
                  <SelectItem value="aspect">Aspect ratio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Fit</Label>
              <Select
                value={sourceFit}
                onValueChange={(v) => onSourceFitChange(v as SourceFitMode)}
                disabled={disabled || sourceSizeMode === 'match'}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="crop">Crop</SelectItem>
                  <SelectItem value="fit">Fit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      ) : null}

      {mode === 'outpaint' && source ? (
        <div className="space-y-2 rounded-md border border-border/60 bg-secondary/20 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
              <ScrubbyNumber
                key={side}
                id={`outpaint-${side}`}
                label={side[0]!.toUpperCase() + side.slice(1)}
                value={outpaint[side]}
                onChange={(n) => patchOutpaint({ [side]: n, targetAspect: null })}
                min={0}
                max={2048}
                step={8}
                defaultValue={0}
                disabled={disabled}
                suffix="px"
              />
            ))}
          </div>
          <ScrubbyNumber
            id="outpaint-feather"
            label="Feather"
            value={outpaint.feather}
            onChange={(n) => patchOutpaint({ feather: n })}
            min={0}
            max={256}
            step={1}
            defaultValue={40}
            disabled={disabled}
            suffix="px"
          />
          <div className="space-y-1">
            <Label className="text-[10px]">Extend to aspect</Label>
            <Select
              value={outpaint.targetAspect || 'custom'}
              onValueChange={(v) => {
                if (v === 'custom') {
                  patchOutpaint({ targetAspect: null });
                  return;
                }
                const pads = padsForAspect(source.width, source.height, v);
                if (pads) patchOutpaint({ ...pads, targetAspect: v });
              }}
              disabled={disabled}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom pads</SelectItem>
                <SelectItem value="1:1">1:1</SelectItem>
                <SelectItem value="16:9">16:9</SelectItem>
                <SelectItem value="9:16">9:16</SelectItem>
                <SelectItem value="4:3">4:3</SelectItem>
                <SelectItem value="3:2">3:2</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ScrubbyNumber
            id="outpaint-denoise"
            label="Denoise"
            value={denoise}
            onChange={onDenoiseChange}
            min={0}
            max={1}
            step={0.05}
            defaultValue={0.7}
            disabled={disabled}
          />
        </div>
      ) : null}

      {mode === 'edit' && source ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Instruction edit uses this family&apos;s ComfyUI edit graph. Describe the change in the
          prompt.
        </p>
      ) : null}
    </div>
  );
}
