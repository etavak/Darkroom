import type { ReactNode } from 'react';

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
