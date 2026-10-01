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
  /** When true, render as an always-open section without the collapsible chrome. */
  asSection?: boolean;
};

export function AdvancedSettings({ open, onOpenChange, children, asSection }: Props) {
  if (asSection) {
    return <div className="flex flex-col gap-3">{children}</div>;
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="section-header flex w-full items-center justify-between rounded-[10px] border border-border bg-secondary/40 px-3 py-2 text-left transition-colors duration-150 hover:bg-secondary">
        Advanced
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground transition-transform duration-150', open && 'rotate-180')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3 data-[state=closed]:animate-out data-[state=open]:animate-in">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
