import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  title: string;
  children: ReactNode;
  className?: string;
  /** Extra actions on the right of the header */
  action?: ReactNode;
};

export function PanelSection({ title, children, className, action }: Props) {
  return (
    <section className={cn('flex flex-col gap-3 border-b border-border/50 pb-5 last:border-b-0 last:pb-0', className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-header">{title}</h2>
        {action}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
