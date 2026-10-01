import { X } from 'lucide-react';
import type { InjectedTag, TagSource } from '@/types/presets';
import { cn } from '@/lib/utils';

type Props = {
  tags: InjectedTag[];
  onRemove: (tag: string) => void;
  disabled?: boolean;
};

export function TagChips({ tags, onRemove, disabled }: Props) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <button
          key={`${t.from}:${t.tag}`}
          type="button"
          disabled={disabled}
          title={`From ${t.from} — click to remove`}
          onClick={() => onRemove(t.tag)}
          className={cn(
            'group inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10',
            disabled && 'pointer-events-none opacity-50',
          )}
        >
          <span className="truncate">{t.tag}</span>
          <SourceBadge from={t.from} />
          <X className="h-3 w-3 shrink-0 opacity-60 group-hover:opacity-100" />
        </button>
      ))}
    </div>
  );
}

function SourceBadge({ from }: { from: TagSource }) {
  return (
    <span className="rounded bg-background/40 px-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
      {from}
    </span>
  );
}
