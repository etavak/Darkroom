import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Check, CheckSquare, Download, Filter, Pin, Trash2, X } from 'lucide-react';
import { StMenuButton } from '../controls/primitives';
import type { PlaneEntry } from './layout';

export type HistoryThumb = { id: string; entry: PlaneEntry; index: number; src: string | null };

type Props = {
  thumbs: HistoryThumb[];
  /** Images in History before search / filters */
  total: number;
  selectedId: string | null;
  onPick: (t: HistoryThumb) => void;
  onContext: (t: HistoryThumb, x: number, y: number) => void;
  isPinned: (recordId: string) => boolean;
  query: string;
  onQuery: (q: string) => void;
  models: Array<{ key: string; name: string; count: number }>;
  model: string;
  onModel: (key: string) => void;
  pinnedOnly: boolean;
  onPinnedOnly: (v: boolean) => void;
  pinnedCount: number;
  onDownload: (thumbs: HistoryThumb[]) => void;
  onDelete: (recordIds: string[]) => void;
  onPin: (recordIds: string[], pin: boolean) => void;
  loading?: boolean;
};

const recordIdOf = (t: HistoryThumb) => (t.entry.kind === 'record' ? t.entry.record.id : null);

/** History: search, filters, a grid sized to the column, and multi-select. */
export function HistoryPanel(p: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState(150);
  const [selectMode, setSelectMode] = useState(false);
  const [multi, setMulti] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setInner(el.clientWidth - 28 - 6));
    ro.observe(el);
    setInner(el.clientWidth - 28 - 6);
    return () => ro.disconnect();
  }, []);

  // Esc leaves select mode
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="menu"]')) {
        setSelectMode(false);
        setMulti([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMode]);

  // Drop selections that are no longer listed (deleted / filtered out)
  const ids = p.thumbs.map((t) => t.id).join('|');
  useEffect(() => {
    const listed = new Set(ids.split('|'));
    setMulti((m) => (m.every((id) => listed.has(id)) ? m : m.filter((id) => listed.has(id))));
  }, [ids]);

  const cols = Math.max(1, Math.floor((inner + 10) / 110));
  const cell = Math.min(150, Math.floor((inner - 10 * (cols - 1)) / cols));
  const filtered = p.model !== 'all' || p.pinnedOnly || p.query.trim() !== '';
  const picked = p.thumbs.filter((t) => multi.includes(t.id));
  const pickedRecords = [...new Set(picked.map(recordIdOf).filter((x): x is string => Boolean(x)))];
  const selectedRecord = p.thumbs.find((t) => t.id === p.selectedId);

  const toggle = (t: HistoryThumb, shift: boolean) => {
    if (!recordIdOf(t)) return;
    setSelectMode(true);
    if (shift && anchor.current) {
      const order = p.thumbs.map((x) => x.id);
      const a = order.indexOf(anchor.current);
      const b = order.indexOf(t.id);
      if (a >= 0 && b >= 0) {
        const range = order.slice(Math.min(a, b), Math.max(a, b) + 1).filter((id) => p.thumbs.some((x) => x.id === id && recordIdOf(x)));
        setMulti((m) => [...new Set([...m, ...range])]);
        return;
      }
    }
    anchor.current = t.id;
    setMulti((m) => (m.includes(t.id) ? m.filter((x) => x !== t.id) : [...m, t.id]));
  };

  const onThumb = (t: HistoryThumb, e: MouseEvent) => {
    if (selectMode || e.metaKey || e.ctrlKey || e.shiftKey) {
      toggle(t, e.shiftKey);
      return;
    }
    p.onPick(t);
  };

  const allPinned = pickedRecords.length > 0 && pickedRecords.every(p.isPinned);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative mb-2 flex gap-1.5 px-3 pb-2.5" style={{ borderBottom: '1px solid var(--s-line)' }}>
        <input
          className="st-search h-8 min-w-0 text-[13px]"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          placeholder="Search prompts"
          aria-label="Search history by prompt"
        />
        <StMenuButton
          tip={filtered ? 'Filters are on' : 'Filter by model or pinned'}
          label="Filter history"
          menuStyle={{ left: 'auto', right: 0, width: 220 }}
          button={
            <span className={`st-ibtn h-8 w-8 ${p.model !== 'all' || p.pinnedOnly ? 'on' : ''}`}>
              <Filter className="h-4 w-4" />
            </span>
          }
        >
          {(close) => (
            <>
              <div className="st-sec px-2.5 pb-0.5 pt-1">Model</div>
              {[{ key: 'all', name: 'All models', count: p.total }, ...p.models].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`st-menu-item justify-between ${p.model === m.key ? 'on' : ''}`}
                  onClick={() => {
                    p.onModel(m.key);
                    close();
                  }}
                >
                  <span className="min-w-0 truncate">{m.name}</span>
                  <span className="st-mono text-[11.5px]" style={{ color: 'var(--s-faint)' }}>{m.count}</span>
                </button>
              ))}
              <div className="mx-1.5 my-1 h-px" style={{ background: 'var(--s-line)' }} />
              <button type="button" className={`st-menu-item justify-between ${p.pinnedOnly ? 'on' : ''}`} onClick={() => p.onPinnedOnly(!p.pinnedOnly)}>
                <span>Pinned only</span>
                <span className="st-mono text-[11.5px]" style={{ color: 'var(--s-faint)' }}>{p.pinnedCount}</span>
              </button>
              {filtered ? (
                <button
                  type="button"
                  className="st-menu-item"
                  style={{ color: 'var(--s-accent)' }}
                  onClick={() => {
                    p.onModel('all');
                    p.onPinnedOnly(false);
                    p.onQuery('');
                    close();
                  }}
                >
                  Clear filters
                </button>
              ) : null}
            </>
          )}
        </StMenuButton>
      </div>

      <div
        ref={gridRef}
        className="st-scroll grid min-h-0 flex-1 content-start justify-center gap-2.5 px-3.5 pb-3.5 pt-1"
        style={{ gridTemplateColumns: `repeat(${cols}, ${cell}px)` }}
      >
        {p.thumbs.length === 0 ? (
          <p className="col-span-full m-0 mt-2 text-[12.5px] leading-normal" style={{ color: 'var(--s-faint)' }}>
            {p.loading ? 'Loading…' : filtered ? 'No images match.' : 'Your images will show up here, newest first.'}
            {filtered && !p.loading ? (
              <button
                type="button"
                className="st-pill mt-1.5 h-6 text-[11.5px]"
                onClick={() => {
                  p.onModel('all');
                  p.onPinnedOnly(false);
                  p.onQuery('');
                }}
              >
                Clear filters
              </button>
            ) : null}
          </p>
        ) : null}
        {p.thumbs.map((t) => {
          const e = t.entry;
          const rid = recordIdOf(t);
          const checked = multi.includes(t.id);
          const n = e.kind === 'record' ? e.images.length : e.kind === 'running' ? Math.max(1, e.settings.batch_size || 1) : 1;
          const s = e.kind === 'record' ? e.record.settings : e.kind === 'running' ? e.settings : e.failed.settings;
          const caption =
            e.kind === 'failed'
              ? `Failed — ${e.failed.error.slice(0, 80)}`
              : `${(s.userPrompt || s.prompt || '').slice(0, 70)}${e.kind === 'running' ? ' · generating' : ''}`;
          return (
            <button
              key={t.id}
              type="button"
              className={`st-hthumb ${(selectMode ? checked : t.id === p.selectedId) ? 'on' : ''}`}
              style={{ height: cell }}
              onClick={(ev) => onThumb(t, ev)}
              onContextMenu={(ev) => {
                ev.preventDefault();
                if (rid) p.onContext(t, ev.clientX, ev.clientY);
              }}
              aria-label={`Show image: ${caption}`}
              data-tip={caption}
            >
              {t.src ? <img src={t.src} alt="" draggable={false} className="inset-0 h-full w-full object-contain" loading="lazy" /> : null}
              {e.kind === 'running' ? (
                <>
                  <span className="st-noise" style={{ backgroundColor: `rgba(40,38,44,${(0.85 * (1 - e.progress)).toFixed(2)})` }} />
                  <span className="st-hbadge st-mono" style={{ left: 6, bottom: 6 }}>{Math.round(e.progress * 100)}%</span>
                </>
              ) : null}
              {e.kind === 'failed' ? (
                <>
                  <span className="st-noise" style={{ backgroundColor: 'rgba(40,38,44,.85)' }} />
                  <span className="st-hbadge font-semibold" style={{ left: 6, bottom: 6, background: '#b8433d' }}>Failed</span>
                </>
              ) : null}
              {rid && p.isPinned(rid) ? (
                <Pin className="absolute right-1.5 top-1.5 h-4 w-4" fill="var(--s-accent)" stroke="rgba(0,0,0,.5)" strokeWidth={1} aria-hidden />
              ) : null}
              {selectMode && rid ? (
                <span className="st-hcheck" style={{ background: checked ? 'var(--s-accent)' : 'rgba(0,0,0,.35)' }}>
                  {checked ? <Check className="h-3 w-3" strokeWidth={3.2} /> : null}
                </span>
              ) : n > 1 ? (
                <span className="st-hbadge st-mono" style={{ left: 6, top: 6 }}>{t.index + 1}/{n}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {selectMode ? (
        <div className="flex flex-col gap-1 px-2.5 py-2" style={{ borderTop: '1px solid var(--s-line)' }}>
          <div className="flex items-center justify-between gap-1.5 px-0.5">
            <span className="text-[12.5px] font-semibold">{picked.length ? `${picked.length} selected` : 'Select images'}</span>
            <button
              type="button"
              className="st-pill h-6 text-[11.5px]"
              onClick={() => {
                const all = p.thumbs.filter((t) => recordIdOf(t)).map((t) => t.id);
                setMulti(multi.length === all.length ? [] : all);
              }}
            >
              {multi.length && multi.length === p.thumbs.filter((t) => recordIdOf(t)).length ? 'Select none' : 'Select all'}
            </button>
          </div>
          <div className="flex justify-center gap-0.5">
            <button type="button" className="st-ibtn" disabled={!pickedRecords.length} onClick={() => p.onPin(pickedRecords, !allPinned)} aria-label={allPinned ? 'Unpin selected' : 'Pin selected'} data-tip={allPinned ? 'Unpin selected' : 'Pin selected'}>
              <Pin />
            </button>
            <button type="button" className="st-ibtn" disabled={!picked.length} onClick={() => p.onDownload(picked)} aria-label="Download selected" data-tip="Download selected as a ZIP">
              <Download />
            </button>
            <button
              type="button"
              className="st-ibtn"
              style={{ color: '#f0857f' }}
              disabled={!pickedRecords.length}
              onClick={() => {
                p.onDelete(pickedRecords);
                setMulti([]);
              }}
              aria-label="Delete selected"
              data-tip="Delete the selected generations (Undo available)"
            >
              <Trash2 />
            </button>
            <button
              type="button"
              className="st-ibtn"
              onClick={() => {
                setSelectMode(false);
                setMulti([]);
              }}
              aria-label="Done selecting"
              data-tip="Done  ·  Esc"
            >
              <X />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-center gap-1.5 p-2" style={{ borderTop: '1px solid var(--s-line)' }}>
          <button type="button" className="st-ibtn" onClick={() => setSelectMode(true)} aria-label="Select images" data-tip="Select several  ·  or Ctrl/Cmd-click, Shift-click">
            <CheckSquare />
          </button>
          <button type="button" className="st-ibtn" disabled={!p.thumbs.some((t) => t.src && recordIdOf(t))} onClick={() => p.onDownload(p.thumbs.filter((t) => recordIdOf(t)))} aria-label="Download all" data-tip={filtered ? 'Download the shown images as a ZIP' : 'Download all as a ZIP'}>
            <Download />
          </button>
          <button
            type="button"
            className="st-ibtn"
            disabled={!selectedRecord || !recordIdOf(selectedRecord)}
            onClick={() => selectedRecord && recordIdOf(selectedRecord) && p.onDelete([recordIdOf(selectedRecord)!])}
            aria-label="Delete selected image"
            data-tip="Delete the selected generation (Undo available)  ·  Del"
          >
            <Trash2 />
          </button>
        </div>
      )}
    </div>
  );
}
