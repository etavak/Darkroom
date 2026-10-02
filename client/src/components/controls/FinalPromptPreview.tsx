import { ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  positive: string;
  negative: string;
  cfg?: number;
  clipSkip?: number;
  sampler?: string;
  checkpoint?: string;
  guidance?: number;
};

function truncateOneLine(text: string, max = 56): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '—';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function FinalPromptPreview({
  open,
  onOpenChange,
  positive,
  negative,
  cfg,
  clipSkip,
  sampler,
  checkpoint,
  guidance,
}: Props) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-start gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-left transition-colors hover:bg-secondary hover:text-foreground">
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Final prompt
          </span>
          {!open ? (
            <span className="mt-0.5 block truncate font-mono text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
              {truncateOneLine(positive)}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2 rounded-md border border-border bg-background/60 p-3">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Positive
          </p>
          <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/90">
            {positive || '—'}
          </p>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Negative
          </p>
          <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/90">
            {negative || '—'}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 font-mono text-[10px] text-muted-foreground">
          {typeof cfg === 'number' && <span>cfg {cfg}</span>}
          {typeof clipSkip === 'number' && <span>clip skip {clipSkip}</span>}
          {typeof guidance === 'number' && <span>guidance {guidance}</span>}
          {sampler && <span>{sampler}</span>}
          {checkpoint && <span className="truncate">{checkpoint}</span>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
