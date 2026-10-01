import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type SettingScope = 'device' | 'server';

export type SettingEntry = {
  id: string;
  label: string;
  description?: string;
  hint?: string;
  icon?: ReactNode;
  control: ReactNode;
  /** Device-local vs shared server setting. */
  scope?: SettingScope;
  /** Extra search terms. */
  keywords?: string[];
};

export function ScopeBadge({ scope }: { scope: SettingScope }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
        scope === 'device'
          ? 'bg-secondary text-muted-foreground'
          : 'bg-primary/15 text-primary',
      )}
    >
      {scope === 'device' ? 'This device' : 'All devices'}
    </span>
  );
}

export function SettingRow({ entry }: { entry: SettingEntry }) {
  return (
    <div className="setting-row flex items-start justify-between gap-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {entry.icon && (
          <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
            {entry.icon}
          </span>
        )}
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={entry.id} className="normal-case tracking-normal text-foreground">
              {entry.label}
            </Label>
            {entry.scope && <ScopeBadge scope={entry.scope} />}
          </div>
          {entry.description && (
            <p className="text-[11px] leading-snug text-muted-foreground">{entry.description}</p>
          )}
          {entry.hint && (
            <p className="text-[11px] leading-snug text-primary/90">{entry.hint}</p>
          )}
        </div>
      </div>
      <div className="shrink-0 pt-0.5">{entry.control}</div>
    </div>
  );
}

export function SettingsGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(className)}>
      <h3 className="settings-group-label">{label}</h3>
      <div className="settings-group divide-y divide-border/40">{children}</div>
    </section>
  );
}
