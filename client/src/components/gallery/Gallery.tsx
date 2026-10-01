import { imageUrl } from '@/lib/api';
import type { GenerationRecord } from '@/types/generation';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { RotateCcw, Trash2 } from 'lucide-react';

type Props = {
  items: GenerationRecord[];
  selectedId: string | null;
  onSelect: (item: GenerationRecord) => void;
  onReuse: (item: GenerationRecord) => void;
  onDelete: (item: GenerationRecord) => void;
  loading?: boolean;
  /** Horizontal strip for mobile bottom bar */
  orientation?: 'vertical' | 'horizontal';
};

export function Gallery({
  items,
  selectedId,
  onSelect,
  onReuse,
  onDelete,
  loading,
  orientation = 'vertical',
}: Props) {
  if (orientation === 'horizontal') {
    return (
      <div className="px-3 py-2">
        <div className="mb-1.5 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            History
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {loading ? 'Loading…' : `${items.length}`}
          </span>
        </div>
        {items.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">No generations yet</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {items.map((item) => (
              <HistoryThumb
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={() => onSelect(item)}
                onReuse={() => onReuse(item)}
                onDelete={() => onDelete(item)}
                compact
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-baseline justify-between border-b px-3 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          History
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {loading ? 'Loading…' : `${items.length} saved`}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-3">
          {items.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Generations will appear here
            </p>
          ) : (
            items.map((item) => (
              <HistoryThumb
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={() => onSelect(item)}
                onReuse={() => onReuse(item)}
                onDelete={() => onDelete(item)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function HistoryThumb({
  item,
  selected,
  onSelect,
  onReuse,
  onDelete,
  compact,
}: {
  item: GenerationRecord;
  selected: boolean;
  onSelect: () => void;
  onReuse: () => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  const thumb = item.images[0] ? imageUrl(item.images[0]) : null;
  const time = new Date(item.createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (compact) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'h-16 w-16 shrink-0 overflow-hidden rounded-md border transition-colors',
          selected ? 'border-primary' : 'border-border',
        )}
      >
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground">
            —
          </div>
        )}
      </button>
    );
  }

  return (
    <div
      className={cn(
        'group overflow-hidden rounded-lg border bg-background transition-colors',
        selected ? 'border-primary' : 'border-border hover:border-muted-foreground/40',
      )}
    >
      <button type="button" onClick={onSelect} className="block w-full">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              empty
            </div>
          )}
        </div>
      </button>
      <div className="space-y-1.5 p-2">
        <p className="truncate text-[10px] text-muted-foreground">{time}</p>
        <p className="line-clamp-2 text-[11px] leading-snug text-foreground/80">
          {item.settings.prompt || '(no prompt)'}
        </p>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 flex-1 gap-1 text-[10px]"
            onClick={onReuse}
          >
            <RotateCcw className="h-3 w-3" />
            Reuse
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
