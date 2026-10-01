import type { ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';

type Props = {
  children: ReactNode;
  footer?: ReactNode;
};

export function SettingsPanel({ children, footer }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 p-4">{children}</div>
      </ScrollArea>
      {footer && <div className="shrink-0 border-t bg-card p-4">{footer}</div>}
    </div>
  );
}
