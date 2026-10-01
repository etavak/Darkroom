import { ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

export function AdvancedSettings({ open, onOpenChange, children }: Props) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
        Advanced settings
        <ChevronDown
          className={cn('h-4 w-4 transition-transform duration-200', open && 'rotate-180')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3 data-[state=closed]:animate-out data-[state=open]:animate-in">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
