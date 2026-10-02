import { imageUrl } from '@/lib/api';
import type { GenerationRecord } from '@/types/generation';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ImagePlus, RotateCcw, Star, Trash2 } from 'lucide-react';
import { ImageInfo } from '@/components/gallery/ImageInfo';

type Props = {
  items: GenerationRecord[];
  selectedId: string | null;
  favorites: Set<string>;
  onSelect: (item: GenerationRecord) => void;
  onReuse: (item: GenerationRecord) => void;
  onDelete: (item: GenerationRecord) => void;
  onToggleFavorite: (item: GenerationRecord) => void;
  onUseAsSource?: (item: GenerationRecord) => void;
  onViewSource?: (parentId: string) => void;
  loading?: boolean;
  orientation?: 'vertical' | 'horizontal';
  /** Show Image Info under the grid (vertical rail) */
  showInfo?: boolean;
  /** The studio draws its own History header */
  showHeader?: boolean;
};

export function Gallery({
  items,
  selectedId,
  favorites,
  onSelect,
  onReuse,
  onDelete,
  onToggleFavorite,
  onUseAsSource,
  onViewSource,
  loading,
  orientation = 'vertical',
  showInfo = true,
  showHeader = true,
}: Props) {
  const sorted = [...items].sort((a, b) => {
    const af = favorites.has(a.id) ? 1 : 0;
    const bf = favorites.has(b.id) ? 1 : 0;
    if (af !== bf) return bf - af;
    return b.createdAt - a.createdAt;
  });

  const selected = sorted.find((i) => i.id === selectedId) ?? null;

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
          <div className="flex gap-1.5 overflow-x-auto pb-1">
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
                onUseAsSource={onUseAsSource ? () => onUseAsSource(item) : undefined}
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
      {showHeader ? (
        <div className="flex shrink-0 items-baseline justify-between border-b px-3 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            History
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {loading ? 'Loading…' : `${items.length}`}
          </span>
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          {sorted.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Generations will appear here
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-3">
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
                  onUseAsSource={onUseAsSource ? () => onUseAsSource(item) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
      {showInfo ? <ImageInfo record={selected} onViewSource={onViewSource} /> : null}
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
  onUseAsSource,
  compact,
}: {
  item: GenerationRecord;
  selected: boolean;
  favorite: boolean;
  onSelect: () => void;
  onReuse: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onUseAsSource?: () => void;
  compact?: boolean;
}) {
  const thumb = item.images[0] ? imageUrl(item.images[0]) : null;
  const derived = Boolean(item.parentId);

  if (compact) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'relative h-14 w-14 shrink-0 overflow-hidden rounded-md border transition-colors',
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
        {derived && (
          <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-0.5 text-[8px] uppercase text-white">
            der
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className={cn(
        'group relative aspect-square overflow-hidden rounded-md border bg-muted transition-colors',
        selected ? 'border-primary' : 'border-border hover:border-muted-foreground/40',
      )}
    >
      <button type="button" onClick={onSelect} className="absolute inset-0 block">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
            empty
          </div>
        )}
      </button>
      {favorite && (
        <Star className="pointer-events-none absolute left-1 top-1 h-3 w-3 fill-primary text-primary drop-shadow" />
      )}
      {derived && (
        <span className="pointer-events-none absolute right-1 top-1 rounded bg-black/65 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-white">
          Derived
        </span>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end gap-0.5 bg-gradient-to-t from-black/70 to-transparent p-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        {onUseAsSource ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-6 w-6 bg-background/90"
            onClick={(e) => {
              e.stopPropagation();
              onUseAsSource();
            }}
            title="Use as source"
          >
            <ImagePlus className="h-3 w-3" />
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-6 w-6 bg-background/90"
          onClick={(e) => {
            e.stopPropagation();
            onReuse();
          }}
          title="Reuse"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className={cn('h-6 w-6 bg-background/90', favorite && 'text-primary')}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          title={favorite ? 'Unfavorite' : 'Favorite'}
        >
          <Star className={cn('h-3 w-3', favorite && 'fill-current')} />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-6 w-6 bg-background/90 text-destructive hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
