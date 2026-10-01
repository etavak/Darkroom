import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  footer?: ReactNode;
};

export function MainStage({ children, footer }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col p-4 md:p-6">
      <div className="min-h-0 flex-1">{children}</div>
      {footer && <div className="mt-4 shrink-0">{footer}</div>}
    </div>
  );
}
