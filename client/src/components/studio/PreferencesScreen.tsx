import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  PREF_CATEGORIES,
  matchesQuery,
  usePreferenceEntries,
  type PrefCategory,
  type PreferenceProps,
} from '@/components/settings/AppSettingsPanel';

const DESCRIPTIONS: Record<PrefCategory, string> = {
  general: 'History and deleting.',
  interface: 'Palette, layout and motion.',
  generation: 'Defaults for new jobs and the queue.',
  performance: 'How ComfyUI uses memory.',
  models: 'Where models and wildcards come from.',
  network: 'The ComfyUI connection and access from other devices.',
  advanced: 'Enhance, logs, backups and diagnostics.',
};

/**
 * Full-screen Preferences for the studio: section list + search across everything.
 * Rows come from the same entries as the classic panel, so every control is live.
 */
export function PreferencesScreen({ onClose, onOpenKeys, ...props }: PreferenceProps & { onClose: () => void; onOpenKeys?: () => void }) {
  const entries = usePreferenceEntries(props);
  const [category, setCategory] = useState<PrefCategory>('general');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="listbox"], [role="menu"]')) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = query.trim();
  const rows = useMemo(
    () => (q ? entries.filter((e) => matchesQuery(e, q)) : entries.filter((e) => e.category === category)),
    [category, entries, q],
  );
  const counts = useMemo(() => {
    if (!q) return null;
    const c: Partial<Record<PrefCategory, number>> = {};
    for (const e of entries) if (matchesQuery(e, q)) c[e.category] = (c[e.category] ?? 0) + 1;
    return c;
  }, [entries, q]);
  const current = PREF_CATEGORIES.find((c) => c.id === category);

  return (
    <div className="st-prefs" role="dialog" aria-label="Preferences">
      <nav
        data-tip-zone="right"
        aria-label="Preference sections"
        className="flex w-[248px] shrink-0 flex-col gap-1 border-r p-3 pt-[18px]"
        style={{ borderColor: 'var(--s-line)' }}
      >
        <div className="flex items-center gap-2.5 px-2 pb-3.5">
          <LogoMark />
          <span className="text-[17px] font-semibold">Preferences</span>
        </div>
        <div className="relative mb-2.5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'var(--s-faint)' }} />
          <input
            className="st-search pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search preferences"
            aria-label="Search preferences"
          />
        </div>
        {PREF_CATEGORIES.map((c) => {
          const on = !q && c.id === category;
          const n = counts?.[c.id];
          return (
            <button
              key={c.id}
              type="button"
              className={`st-navitem ${on ? 'on' : ''}`}
              aria-current={on}
              onClick={() => {
                setCategory(c.id);
                setQuery('');
              }}
            >
              <span>{c.label}</span>
              {n ? <span className="st-mono text-[11.5px]" style={{ color: 'var(--s-faint)' }}>{n}</span> : null}
            </button>
          );
        })}
        {onOpenKeys ? (
          <>
            <span className="flex-1" />
            <button type="button" className="st-navitem" onClick={onOpenKeys}>
              <span>Keyboard shortcuts</span>
              <span className="st-kbd">?</span>
            </button>
          </>
        ) : null}
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto box-border max-w-[720px] px-10 pb-20 pt-[30px]">
          <h1 className="m-0 text-2xl font-semibold tracking-tight">
            {q ? `Results for “${q}”` : current?.label}
          </h1>
          <p className="mb-2 mt-1.5 text-sm" style={{ color: 'var(--s-muted)' }}>
            {q ? `${rows.length} setting${rows.length === 1 ? '' : 's'} found` : DESCRIPTIONS[category]}
            {' '}Changes apply immediately.
          </p>
          {props.serverLoading ? (
            <p className="text-xs" style={{ color: 'var(--s-faint)' }}>Loading server settings…</p>
          ) : null}
          {rows.length === 0 ? (
            <p className="my-6 text-sm" style={{ color: 'var(--s-muted)' }}>Nothing matches. Try another word.</p>
          ) : (
            rows.map((e) => (
              <div key={e.id} className="st-prow">
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="flex flex-wrap items-center gap-2">
                    <label htmlFor={e.id} className="text-[14.5px] font-semibold">{e.label}</label>
                    <span
                      className="st-scope"
                      style={
                        e.scope === 'server'
                          ? { background: 'var(--s-accent-soft)', color: 'var(--s-accent)' }
                          : { background: 'var(--s-raised)', color: 'var(--s-muted)' }
                      }
                    >
                      {e.scope === 'server' ? 'All devices' : 'This device'}
                    </span>
                  </span>
                  {e.description ? (
                    <span className="text-[13px] leading-[1.45]" style={{ color: 'var(--s-muted)' }}>{e.description}</span>
                  ) : null}
                  {e.hint ? <span className="text-[12.5px]" style={{ color: 'var(--s-accent)' }}>{e.hint}</span> : null}
                  {q ? <span className="st-sec pt-0.5 text-[11px]">{PREF_CATEGORIES.find((c) => c.id === e.category)?.label}</span> : null}
                </div>
                <div className="shrink-0">{e.control}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <button
        type="button"
        className="st-ibtn absolute right-3.5 top-3.5"
        onClick={onClose}
        aria-label="Close preferences"
        data-tip="Close  ·  Esc"
      >
        <X />
      </button>
    </div>
  );
}

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--s-accent)" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.2" fill="var(--s-accent)" />
    </svg>
  );
}
