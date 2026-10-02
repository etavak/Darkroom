import { useEffect, useRef, useState } from 'react';
import {
  Copy,
  Download,
  ImagePlus,
  RotateCcw,
  StretchHorizontal,
  Trash2,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { imageUrl } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { GenerationRecord } from '@/types/generation';

export type UpscaleRequest = {
  model: string;
  scale: 2 | 4;
  refine: boolean;
};

export type VaryStrength = 'subtle' | 'strong';

type Props = {
  /** Only history-backed records — action bar hidden without one */
  record: GenerationRecord | null;
  upscaleModels: string[];
  defaultUpscaler?: string;
  visible: boolean;
  onReuse: () => void;
  onDelete: () => void;
  onCopySeed: () => void;
  onUpscale: (req: UpscaleRequest) => void;
  onVary: (strength: VaryStrength) => void;
  onUseAsSource?: () => void;
  busy?: boolean;
};

export function ResultActionBar({
  record,
  upscaleModels,
  defaultUpscaler,
  visible,
  onReuse,
  onDelete,
  onCopySeed,
  onUpscale,
  onVary,
  onUseAsSource,
  busy,
}: Props) {
  const [menu, setMenu] = useState<'upscale' | 'vary' | null>(null);
  const [upModel, setUpModel] = useState('');
  const [upScale, setUpScale] = useState<2 | 4>(2);
  const [upRefine, setUpRefine] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!upModel && upscaleModels.length) {
      const preferred =
        (defaultUpscaler && upscaleModels.includes(defaultUpscaler) && defaultUpscaler) ||
        upscaleModels[0];
      setUpModel(preferred);
    }
  }, [upscaleModels, defaultUpscaler, upModel]);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

  if (!visible || !record || record.images.length === 0) return null;

  const primary = record.images[0];

  const download = async () => {
    const res = await fetch(imageUrl(primary));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = primary;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center justify-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void download()}
        disabled={busy}
      >
        <Download className="h-3.5 w-3.5" />
        Download
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onCopySeed} disabled={busy}>
        <Copy className="h-3.5 w-3.5" />
        Copy seed
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onReuse} disabled={busy}>
        <RotateCcw className="h-3.5 w-3.5" />
        Reuse
      </Button>
      {onUseAsSource ? (
        <Button type="button" variant="outline" size="sm" onClick={onUseAsSource} disabled={busy}>
          <ImagePlus className="h-3.5 w-3.5" />
          Use as source
        </Button>
      ) : null}

      <div className="relative">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || upscaleModels.length === 0}
          title={upscaleModels.length === 0 ? 'No upscale models installed' : 'Upscale'}
          onClick={() => setMenu((m) => (m === 'upscale' ? null : 'upscale'))}
        >
          <StretchHorizontal className="h-3.5 w-3.5" />
          Upscale
        </Button>
        {menu === 'upscale' && (
          <div className="absolute bottom-[calc(100%+6px)] left-1/2 z-50 w-64 -translate-x-1/2 space-y-2 rounded-[10px] border border-border bg-popover p-3 shadow-md">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Upscale
            </p>
            <Select value={upModel} onValueChange={setUpModel}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                {upscaleModels.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-1">
              {([2, 4] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={cn(
                    'h-8 flex-1 rounded-[8px] border text-xs font-medium',
                    upScale === s
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border hover:bg-secondary',
                  )}
                  onClick={() => setUpScale(s)}
                >
                  {s}×
                </button>
              ))}
            </div>
            <label className="flex items-center justify-between gap-2 text-xs">
              <span>Refine pass</span>
              <Switch checked={upRefine} onCheckedChange={setUpRefine} />
            </label>
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!upModel}
              onClick={() => {
                onUpscale({ model: upModel, scale: upScale, refine: upRefine });
                setMenu(null);
              }}
            >
              Run upscale
            </Button>
          </div>
        )}
      </div>

      <div className="relative">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setMenu((m) => (m === 'vary' ? null : 'vary'))}
        >
          <Wand2 className="h-3.5 w-3.5" />
          Vary
        </Button>
        {menu === 'vary' && (
          <div className="absolute bottom-[calc(100%+6px)] left-1/2 z-50 w-48 -translate-x-1/2 space-y-1 rounded-[10px] border border-border bg-popover p-1.5 shadow-md">
            <button
              type="button"
              className="flex w-full flex-col rounded-[8px] px-2.5 py-2 text-left hover:bg-accent"
              onClick={() => {
                onVary('subtle');
                setMenu(null);
              }}
            >
              <span className="text-xs font-medium">Subtle</span>
              <span className="text-[10px] text-muted-foreground">Denoise 0.3 · new seed</span>
            </button>
            <button
              type="button"
              className="flex w-full flex-col rounded-[8px] px-2.5 py-2 text-left hover:bg-accent"
              onClick={() => {
                onVary('strong');
                setMenu(null);
              }}
            >
              <span className="text-xs font-medium">Strong</span>
              <span className="text-[10px] text-muted-foreground">Denoise 0.6 · new seed</span>
            </button>
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 text-destructive hover:text-destructive"
        onClick={onDelete}
        disabled={busy}
        title="Delete"
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
