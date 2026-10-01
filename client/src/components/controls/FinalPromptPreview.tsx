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
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
        Final prompt
        <ChevronDown
          className={cn('h-4 w-4 transition-transform duration-200', open && 'rotate-180')}
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
