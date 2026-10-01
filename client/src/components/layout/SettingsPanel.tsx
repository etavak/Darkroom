import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  footer?: ReactNode;
};

/**
 * Left controls column: scrollable body + pinned footer (Generate) outside the scroll.
 */
export function SettingsPanel({ children, footer }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-6 p-4">{children}</div>
      </div>
      {footer && (
        <div className="z-10 shrink-0 border-t bg-card p-4 shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.55)]">
          {footer}
        </div>
      )}
    </div>
  );
}
