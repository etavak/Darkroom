import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { searchTagsApi, validateTagsApi } from '@/lib/api';
import type { TagCategory, TagSuggestion } from '@/types/presets';

const CATEGORY_COLOR: Record<TagCategory, string> = {
  general: 'text-sky-400',
  artist: 'text-amber-400',
  character: 'text-emerald-400',
  copyright: 'text-fuchsia-400',
  meta: 'text-zinc-400',
};

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** Split prompt into comma-separated tag segments (preserving separators). */
function splitTagSegments(value: string): Array<{ text: string; isSep: boolean }> {
  const parts: Array<{ text: string; isSep: boolean }> = [];
  let cur = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === ',') {
      parts.push({ text: cur, isSep: false });
      cur = '';
      // include following spaces with separator
      let sep = ',';
      while (i + 1 < value.length && value[i + 1] === ' ') {
        i++;
        sep += ' ';
      }
      parts.push({ text: sep, isSep: true });
    } else {
      cur += ch;
    }
  }
  parts.push({ text: cur, isSep: false });
  return parts;
}

function tokenAtCursor(value: string, cursor: number): { start: number; end: number; query: string } {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const start = before.lastIndexOf(',') + 1;
  const nextComma = after.indexOf(',');
  const end = nextComma === -1 ? value.length : cursor + nextComma;
  const raw = value.slice(start, end);
  const leading = raw.match(/^\s*/)?.[0].length ?? 0;
  return {
    start: start + leading,
    end,
    query: raw.trimStart().replace(/\s+$/, ''),
  };
}

type Props = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  familyId: string | null;
  tagsEnabled: boolean;
};

export function TagPromptInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  className,
  familyId,
  tagsEnabled,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const searchGen = useRef(0);

  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    const mirror = mirrorRef.current;
    if (ta && mirror) {
      mirror.scrollTop = ta.scrollTop;
      mirror.scrollLeft = ta.scrollLeft;
    }
  }, []);

  useLayoutEffect(() => {
    syncScroll();
  }, [value, syncScroll]);

  // Autocomplete fetch
  useEffect(() => {
    if (!tagsEnabled || !familyId || disabled) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const { query } = tokenAtCursor(value, cursor);
    if (!query || query.length < 1) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    // Don't suggest inside intentional weight syntax mid-edit after colon
    if (/^\(.+:[\d.]*$/.test(query) && query.includes(':')) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const gen = ++searchGen.current;
    const t = window.setTimeout(() => {
      void searchTagsApi({ q: query, family: familyId, limit: 12 }).then((res) => {
        if (gen !== searchGen.current) return;
        setSuggestions(res.suggestions);
        setOpen(res.suggestions.length > 0);
        setActiveIdx(0);
      }).catch(() => {
        if (gen !== searchGen.current) return;
        setSuggestions([]);
        setOpen(false);
      });
    }, 80);
    return () => window.clearTimeout(t);
  }, [value, cursor, familyId, tagsEnabled, disabled]);

  // Unknown tag underline validation
  useEffect(() => {
    if (!tagsEnabled || !familyId) {
      setUnknown(new Set());
      return;
    }
    const tags = splitTagSegments(value)
      .filter((p) => !p.isSep)
      .map((p) => p.text.trim())
      .filter(Boolean);
    if (tags.length === 0) {
      setUnknown(new Set());
      return;
    }
    const t = window.setTimeout(() => {
      void validateTagsApi({ family: familyId, tags }).then((res) => {
        setUnknown(new Set(res.unknown.map((u) => u.trim())));
      }).catch(() => setUnknown(new Set()));
    }, 200);
    return () => window.clearTimeout(t);
  }, [value, familyId, tagsEnabled]);

  const insertSuggestion = useCallback(
    (s: TagSuggestion) => {
      const ta = taRef.current;
      const c = ta?.selectionStart ?? cursor;
      const { start, end } = tokenAtCursor(value, c);
      const insert = `${s.displayName}, `;
      const next = value.slice(0, start) + insert + value.slice(end).replace(/^\s*/, '');
      onChange(next);
      setOpen(false);
      setSuggestions([]);
      requestAnimationFrame(() => {
        const pos = start + insert.length;
        ta?.focus();
        ta?.setSelectionRange(pos, pos);
        setCursor(pos);
      });
    },
    [cursor, onChange, value],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      insertSuggestion(suggestions[activeIdx] ?? suggestions[0]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const segments = splitTagSegments(value);

  return (
    <div className="relative">
      <div className="relative">
        {tagsEnabled && (
          <div
            ref={mirrorRef}
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-[8px] border border-transparent px-3 py-2 text-sm leading-relaxed text-foreground',
              className,
            )}
          >
            {segments.map((seg, i) => {
              if (seg.isSep) {
                return <span key={i}>{seg.text}</span>;
              }
              const trimmed = seg.text.trim();
              const isUnknown = trimmed.length > 0 && unknown.has(trimmed);
              const lead = seg.text.match(/^\s*/)?.[0] ?? '';
              const trail = seg.text.match(/\s*$/)?.[0] ?? '';
              const core = seg.text.slice(lead.length, seg.text.length - trail.length);
              return (
                <span key={i}>
                  {lead}
                  <span
                    className={
                      isUnknown
                        ? 'underline decoration-rose-400 decoration-wavy underline-offset-2'
                        : undefined
                    }
                  >
                    {core.length > 0 ? core : '\u200b'}
                  </span>
                  {trail}
                </span>
              );
            })}
            {/* trailing newline mirror for scroll height */}
            {'\n'}
          </div>
        )}
        <Textarea
          ref={taRef}
          id={id}
          className={cn(
            'relative min-h-[100px] resize-y leading-relaxed',
            tagsEnabled && 'bg-transparent text-transparent caret-foreground',
            className,
          )}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setCursor(e.target.selectionStart);
          }}
          onClick={(e) => setCursor(e.currentTarget.selectionStart)}
          onKeyUp={(e) => setCursor(e.currentTarget.selectionStart)}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-[10px] border border-border bg-popover py-1 text-sm shadow-md"
          role="listbox"
        >
          {suggestions.map((s, i) => (
            <li key={`${s.name}-${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIdx}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent',
                  i === activeIdx && 'bg-accent',
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertSuggestion(s);
                }}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <span className={cn('min-w-0 flex-1 truncate font-medium', CATEGORY_COLOR[s.category])}>
                  {s.displayName}
                </span>
                {s.matchedAlias && (
                  <span className="truncate text-[10px] text-muted-foreground">
                    ← {s.matchedAlias}
                  </span>
                )}
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {formatCount(s.postCount)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
