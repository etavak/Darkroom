import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  content: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
};

/** Lightweight tooltip — no extra dependency. */
export function Tooltip({ content, children, side = 'top', className }: Props) {
  return (
    // data-tip lets the studio's tooltip layer place it outside clipping panels; the
    // CSS tooltip below is the classic layout's and is hidden in the studio.
    <span className={cn('group/tip relative inline-flex', className)} data-tip={content}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'legacy-tip',
          'pointer-events-none absolute left-1/2 z-50 w-max max-w-[220px] -translate-x-1/2 rounded-[8px] border border-border bg-popover px-2 py-1.5 text-left text-[11px] font-normal normal-case tracking-normal text-popover-foreground opacity-0 shadow-md transition-opacity duration-150',
          'group-hover/tip:opacity-100 group-focus-within/tip:opacity-100',
          side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
        )}
      >
        {content}
      </span>
    </span>
  );
}
