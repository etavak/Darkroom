import { Download, Copy, RotateCcw, StretchHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { imageUrl } from '@/lib/api';
import type { GenerationRecord } from '@/types/generation';

type Props = {
  record: GenerationRecord | null;
  images: string[];
  visible: boolean;
  onReuse: () => void;
  onDelete: () => void;
  onCopySeed: () => void;
};

export function ResultActionBar({
  record,
  images,
  visible,
  onReuse,
  onDelete,
  onCopySeed,
}: Props) {
  if (!visible || images.length === 0) return null;

  const primary = images[0];

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
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      <Button type="button" variant="outline" size="sm" onClick={() => void download()}>
        <Download className="h-3.5 w-3.5" />
        Download
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onCopySeed} disabled={!record}>
        <Copy className="h-3.5 w-3.5" />
        Copy seed
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onReuse} disabled={!record}>
        <RotateCcw className="h-3.5 w-3.5" />
        Reuse
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        title="Upscaling comes in a later phase"
      >
        <StretchHorizontal className="h-3.5 w-3.5" />
        Upscale
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={onDelete}
        disabled={!record}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </Button>
    </div>
  );
}
