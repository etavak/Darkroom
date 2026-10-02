import type { ReactNode, MouseEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  id: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Alt/Option-click: collapse every other section */
  onSolo?: () => void;
  summary?: string | null;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function CollapsibleSection({
  id,
  title,
  open,
  onOpenChange,
  onSolo,
  summary,
  action,
  children,
  className,
}: Props) {
  const onHeaderClick = (e: MouseEvent) => {
    if (e.altKey && onSolo) {
      e.preventDefault();
      onSolo();
      return;
    }
    onOpenChange(!open);
  };

  return (
    <section
      data-section={id}
      className={cn(
        'flex flex-col border-b border-border/50 last:border-b-0',
        open ? 'pb-5 gap-3' : 'pb-3',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onHeaderClick}
          className="group flex min-w-0 flex-1 items-start gap-2 rounded-[8px] py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          title="Alt-click to collapse other sections"
        >
          <ChevronDown
            className={cn(
              'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
              !open && '-rotate-90',
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="section-header block leading-none">{title}</span>
            {!open && summary ? (
              <span className="mt-1 block truncate font-mono text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
                {summary}
              </span>
            ) : null}
          </span>
        </button>
        {action ? <div className="shrink-0 pt-0.5">{action}</div> : null}
      </div>
      {open ? <div className="flex flex-col gap-3">{children}</div> : null}
    </section>
  );
}
