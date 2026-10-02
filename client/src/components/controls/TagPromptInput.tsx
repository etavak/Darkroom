import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Textarea } from '@/components/ui/textarea';
import {
  CATEGORY_COLORS,
  highlightPromptSyntax,
  highlightStyle,
  type HighlightOptions,
} from '@/lib/promptHighlight';
import { cn } from '@/lib/utils';
import { searchTagsApi, validateTagsApi } from '@/lib/api';
import type { TagCategory, TagSuggestion } from '@/types/presets';

const CATEGORY_TEXT: Record<TagCategory, string> = {
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

/** Lowercase, spaces for underscores, weight syntax stripped — for matching tags. */
function tagKey(t: string): string {
  return t
    .trim()
    .replace(/^\(+|\)+$/g, '')
    .replace(/:\s*-?[\d.]+$/, '')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Overlay text: weight / choice / wildcard runs, and in tag mode each tag's category colour,
 * unknown-tag underline and the "added by Enhance" tint.
 */
function buildOverlay(
  value: string,
  opts: {
    tags: boolean;
    paint: boolean;
    unknown: Set<string>;
    categories: Record<string, string>;
    newTags: Set<string>;
  },
): ReactNode[] {
  const paint = (text: string): ReactNode => (opts.paint ? highlightPromptSyntax(text) : text);
  if (!opts.tags) return [paint(value)];

  const nodes: ReactNode[] = [];
  let i = 0;
  for (const seg of splitTagSegments(value)) {
    if (seg.isSep) {
      nodes.push(<span key={`s-${i++}`}>{seg.text}</span>);
      continue;
    }
    const trimmed = seg.text.trim();
    const lead = seg.text.match(/^\s*/)?.[0] ?? '';
    const trail = seg.text.match(/\s*$/)?.[0] ?? '';
    const core = seg.text.slice(lead.length, seg.text.length - trail.length);
    const cls = [
      trimmed && opts.unknown.has(trimmed) ? 'hl-unk' : '',
      trimmed && opts.categories[trimmed] ? `hl-cat-${opts.categories[trimmed]}` : '',
      trimmed && opts.newTags.has(tagKey(trimmed)) ? 'hl-new' : '',
    ]
      .filter(Boolean)
      .join(' ');
    nodes.push(
      <span key={`p-${i++}`}>
        {lead}
        <span className={cls || undefined}>{core.length > 0 ? paint(core) : '\u200b'}</span>
        {trail}
      </span>,
    );
  }
  return nodes;
}

/** Splits a suggestion name around the typed text so the match can be emphasised. */
function splitHit(name: string, query: string): [string, string, string] {
  const norm = (t: string) => t.toLowerCase().replace(/_/g, ' ');
  const q = norm(query).trim();
  const at = q ? norm(name).indexOf(q) : -1;
  if (at < 0) return [name, '', ''];
  return [name.slice(0, at), name.slice(at, at + q.length), name.slice(at + q.length)];
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
  /** Highlight (tag:1.2) and {a|b} via overlay (default true). */
  highlightSyntax?: boolean;
  /** Full highlight options (studio); overrides highlightSyntax / underlineUnknown */
  hl?: HighlightOptions;
  /** Tags to tint as "added by Enhance" */
  newTags?: string[];
  /**
   * Studio look: no box, the text sits straight on the card. The wrapper takes className
   * (give it a height) and the suggestion list opens at the caret.
   */
  bare?: boolean;
  /** Tag suggestions while typing (default true). */
  autocomplete?: boolean;
  /** How an accepted suggestion is written (default: the dictionary's display name). */
  insertFormat?: 'spaces' | 'underscores';
  /** Wavy underline under unknown tags (default true). */
  underlineUnknown?: boolean;
  /** Called when the suggestion list opens or closes (the studio hides tooltips meanwhile). */
  onSuggestionsOpenChange?: (open: boolean) => void;
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
  highlightSyntax = true,
  autocomplete = true,
  insertFormat,
  underlineUnknown: underlineProp = true,
  onSuggestionsOpenChange,
  hl,
  newTags,
  bare,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Record<string, string>>({});
  /** Suggestions only follow typing: clicking, arrowing around or leaving the box closes them */
  const [armed, setArmed] = useState(false);
  const [acPos, setAcPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const searchGen = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const paint = hl ? hl.highlight : highlightSyntax;
  const underlineUnknown = hl ? hl.highlight && hl.underlineUnknown : underlineProp;
  const showOverlay = paint || (tagsEnabled && underlineUnknown);
  const hlLook = hl ? highlightStyle(hl) : { className: 'hl-root', style: undefined };
  const newSet = new Set((newTags ?? []).map(tagKey));

  useEffect(() => {
    onSuggestionsOpenChange?.(open && suggestions.length > 0);
  }, [onSuggestionsOpenChange, open, suggestions.length]);

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

  useEffect(() => {
    if (!tagsEnabled || !familyId || disabled || !autocomplete || !armed) {
      searchGen.current += 1;
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
    if (/^\(.+:[\d.]*$/.test(query) && query.includes(':')) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const gen = ++searchGen.current;
    const t = window.setTimeout(() => {
      void searchTagsApi({ q: query, family: familyId, limit: 12 })
        .then((res) => {
          if (gen !== searchGen.current) return;
          setSuggestions(res.suggestions);
          setOpen(res.suggestions.length > 0);
          setActiveIdx(0);
        })
        .catch(() => {
          if (gen !== searchGen.current) return;
          setSuggestions([]);
          setOpen(false);
        });
    }, 80);
    return () => window.clearTimeout(t);
  }, [value, cursor, familyId, tagsEnabled, disabled, autocomplete, armed]);

  // Place the list under the caret (studio): measure the text up to the cursor in a hidden copy
  const listOpen = open && suggestions.length > 0;
  useLayoutEffect(() => {
    if (!bare || !listOpen) return;
    const box = boxRef.current;
    const m = measureRef.current;
    const ta = taRef.current;
    if (!box || !m || !ta) return;
    m.textContent = value.slice(0, cursor);
    const mark = document.createElement('span');
    mark.textContent = '\u200b';
    m.appendChild(mark);
    const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    const width = Math.min(290, box.clientWidth + 8);
    const top = Math.round(mark.offsetTop - ta.scrollTop + lineH + 4);
    const left = Math.round(Math.max(-4, Math.min(mark.offsetLeft - 10, box.clientWidth - width + 4)));
    setAcPos((cur) => (cur && cur.top === top && cur.left === left && cur.width === width ? cur : { top, left, width }));
  }, [bare, listOpen, value, cursor]);

  useEffect(() => {
    if (!tagsEnabled || !familyId) {
      setUnknown(new Set());
      setCategories({});
      return;
    }
    const tags = splitTagSegments(value)
      .filter((p) => !p.isSep)
      .map((p) => p.text.trim())
      // Wildcard segments resolve server-side; don't flag them as unknown tags
      .filter((t) => t && !/[{}|]|__[\w\-./ ]+?__/.test(t));
    if (tags.length === 0) {
      setUnknown(new Set());
      setCategories({});
      return;
    }
    const t = window.setTimeout(() => {
      void validateTagsApi({ family: familyId, tags })
        .then((res) => {
          setUnknown(new Set(res.unknown.map((u) => u.trim())));
          setCategories(res.categories ?? {});
        })
        .catch(() => {
          setUnknown(new Set());
          setCategories({});
        });
    }, 200);
    return () => window.clearTimeout(t);
  }, [value, familyId, tagsEnabled]);

  const insertSuggestion = useCallback(
    (s: TagSuggestion) => {
      const ta = taRef.current;
      const c = ta?.selectionStart ?? cursor;
      const { start, end } = tokenAtCursor(value, c);
      const name =
        insertFormat === 'underscores'
          ? s.displayName.replace(/ /g, '_')
          : insertFormat === 'spaces'
            ? s.displayName.replace(/_/g, ' ')
            : s.displayName;
      const insert = `${name}, `;
      const next = value.slice(0, start) + insert + value.slice(end).replace(/^\s*/, '');
      onChange(next);
      setArmed(false);
      setOpen(false);
      setSuggestions([]);
      requestAnimationFrame(() => {
        const pos = start + insert.length;
        ta?.focus();
        ta?.setSelectionRange(pos, pos);
        setCursor(pos);
      });
    },
    [cursor, insertFormat, onChange, value],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Moving the caret without typing closes the list
    const moves = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
    if (moves.includes(e.key) || (!listOpen && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) {
      setArmed(false);
      return;
    }
    if (!listOpen) return;
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
      e.stopPropagation();
      setArmed(false);
      setOpen(false);
    }
  };

  const textareaHandlers = {
    value,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      setCursor(e.target.selectionStart);
      setArmed(true);
    },
    onMouseDown: () => setArmed(false),
    onBlur: () => setArmed(false),
    onKeyUp: (e: KeyboardEvent<HTMLTextAreaElement>) => setCursor(e.currentTarget.selectionStart),
    onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement>) => setCursor(e.currentTarget.selectionStart),
    onScroll: syncScroll,
    onKeyDown,
    placeholder,
    disabled,
    autoComplete: 'off',
    spellCheck: false,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': listOpen,
  };

  const overlay = buildOverlay(value, {
    tags: tagsEnabled,
    paint,
    unknown: underlineUnknown ? unknown : new Set<string>(),
    categories,
    newTags: newSet,
  });

  const query = tokenAtCursor(value, cursor).query;

  if (bare) {
    return (
      <div ref={boxRef} className={cn('st-pwrap', className)}>
        {showOverlay ? (
          <div ref={mirrorRef} aria-hidden className={cn('st-ta st-ta-hl', hlLook.className)} style={hlLook.style}>
            {overlay}
            {'\n'}
          </div>
        ) : null}
        <div ref={measureRef} aria-hidden className="st-ta st-ta-measure" />
        <textarea ref={taRef} id={id} className={cn('st-ta', showOverlay && 'st-ta-clear')} {...textareaHandlers} />
        {listOpen && acPos ? (
          <div
            className="st-ac"
            data-tip-avoid
            role="listbox"
            aria-label="Tag suggestions"
            style={{ top: acPos.top, left: acPos.left, width: acPos.width }}
          >
            {suggestions.map((s, i) => {
              const [pre, hit, post] = splitHit(s.displayName, query);
              return (
                <button
                  key={`${s.name}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === activeIdx}
                  className={cn('st-ac-item', i === activeIdx && 'on')}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertSuggestion(s);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <span className="st-ac-dot" style={{ background: CATEGORY_COLORS[s.category] ?? CATEGORY_COLORS.general }} />
                  <span className="min-w-0 flex-1 truncate">
                    {pre}
                    <span className="st-ac-hit">{hit}</span>
                    {post}
                    {s.matchedAlias ? <span className="st-ac-alias"> ← {s.matchedAlias}</span> : null}
                  </span>
                  <span className="st-mono st-ac-meta">{formatCount(s.postCount)}</span>
                </button>
              );
            })}
            <div className="st-ac-foot">
              <span>↑↓ choose · Tab insert · Esc close</span>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        {showOverlay && (
          <div
            ref={mirrorRef}
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-[8px] border border-transparent px-3 py-2 text-sm leading-relaxed text-foreground',
              hlLook.className,
              className,
            )}
            style={hlLook.style}
          >
            {overlay}
            {'\n'}
          </div>
        )}
        <Textarea
          ref={taRef}
          id={id}
          className={cn(
            'relative min-h-[100px] resize-y leading-relaxed',
            showOverlay && 'bg-transparent text-transparent caret-foreground',
            className,
          )}
          {...textareaHandlers}
        />
      </div>
      {listOpen && (
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
                <span className={cn('min-w-0 flex-1 truncate font-medium', CATEGORY_TEXT[s.category])}>
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
