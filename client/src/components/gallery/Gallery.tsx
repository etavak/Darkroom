import { imageUrl } from '@/lib/api';
import type { GenerationRecord } from '@/types/generation';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { RotateCcw, Star, Trash2 } from 'lucide-react';

type Props = {
  items: GenerationRecord[];
  selectedId: string | null;
  favorites: Set<string>;
  onSelect: (item: GenerationRecord) => void;
  onReuse: (item: GenerationRecord) => void;
  onDelete: (item: GenerationRecord) => void;
  onToggleFavorite: (item: GenerationRecord) => void;
  loading?: boolean;
  orientation?: 'vertical' | 'horizontal';
};

export function Gallery({
  items,
  selectedId,
  favorites,
  onSelect,
  onReuse,
  onDelete,
  onToggleFavorite,
  loading,
  orientation = 'vertical',
}: Props) {
  const sorted = [...items].sort((a, b) => {
    const af = favorites.has(a.id) ? 1 : 0;
    const bf = favorites.has(b.id) ? 1 : 0;
    if (af !== bf) return bf - af;
    return b.createdAt - a.createdAt;
  });

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
        {sorted.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">No generations yet</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sorted.map((item) => (
              <HistoryThumb
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                favorite={favorites.has(item.id)}
                onSelect={() => onSelect(item)}
                onReuse={() => onReuse(item)}
                onDelete={() => onDelete(item)}
                onToggleFavorite={() => onToggleFavorite(item)}
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
          {sorted.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Generations will appear here
            </p>
          ) : (
            sorted.map((item) => (
              <HistoryThumb
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                favorite={favorites.has(item.id)}
                onSelect={() => onSelect(item)}
                onReuse={() => onReuse(item)}
                onDelete={() => onDelete(item)}
                onToggleFavorite={() => onToggleFavorite(item)}
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
  favorite,
  onSelect,
  onReuse,
  onDelete,
  onToggleFavorite,
  compact,
}: {
  item: GenerationRecord;
  selected: boolean;
  favorite: boolean;
  onSelect: () => void;
  onReuse: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
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
          'relative h-16 w-16 shrink-0 overflow-hidden rounded-md border transition-colors',
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
        {favorite && (
          <Star className="absolute right-0.5 top-0.5 h-3 w-3 fill-primary text-primary" />
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
      <button type="button" onClick={onSelect} className="relative block w-full">
        <div className="aspect-square w-full overflow-hidden bg-muted">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              empty
            </div>
          )}
        </div>
        {favorite && (
          <Star className="absolute right-1.5 top-1.5 h-3.5 w-3.5 fill-primary text-primary drop-shadow" />
        )}
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
            className={cn('h-7 w-7', favorite ? 'text-primary' : 'text-muted-foreground')}
            onClick={onToggleFavorite}
            aria-label={favorite ? 'Unfavorite' : 'Favorite'}
            title={favorite ? 'Unfavorite' : 'Favorite (F)'}
          >
            <Star className={cn('h-3.5 w-3.5', favorite && 'fill-current')} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="Delete"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
