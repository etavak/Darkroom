import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { fetchWildcards } from '@/lib/api';
import { deleteSnippet, loadRecentPrompts, loadSnippets, saveSnippet, type PromptSnippet } from '@/lib/promptLibrary';
import { HIGHLIGHT_PALETTE, highlightStyle } from '@/lib/promptHighlight';
import type { PromptPrefs } from '@/lib/promptPrefs';
import { StSeg, StSwitch } from './primitives';

type HlKey = 'hlWeights' | 'hlChoices' | 'hlWildcards' | 'hlCategory' | 'underlineUnknown' | 'hlNew';

const HL_ROWS: Array<{ key: HlKey; name: string; sample: string; tip: string; colorKey?: keyof PromptPrefs['hlColors']; deco?: string }> = [
  { key: 'hlWeights', name: 'Weights', sample: '(smile:1.2)', colorKey: 'weights', tip: 'Colour (tag:1.2) emphasis' },
  { key: 'hlChoices', name: 'Random choices', sample: '{day|night}', colorKey: 'choices', tip: 'Colour {a|b} — one option is picked per image' },
  { key: 'hlWildcards', name: 'Wildcards', sample: '__hair__', colorKey: 'wildcards', tip: 'Colour __name__ — filled from your wildcard files' },
  { key: 'hlCategory', name: 'Tag categories', sample: 'character · copyright · meta', tip: 'Colour character, copyright, artist and meta tags the Danbooru way (tag models only)' },
  { key: 'underlineUnknown', name: 'Unknown tags', sample: 'red squiggle', deco: 'underline wavy #e5534b', tip: 'Underline tags the dictionary doesn’t recognise (tag models only)' },
  { key: 'hlNew', name: 'Tags added by Enhance', sample: 'green tint', tip: 'Tint the tags AI enhance added until you keep them' },
];

/** A fixed sample prompt painted with the current highlight settings */
function HighlightPreview({ prefs }: { prefs: PromptPrefs }) {
  const look = highlightStyle(prefs);
  const parts: Array<[string, string]> = [
    ['1girl', ''],
    ['hatsune miku', 'hl-cat-character'],
    ['vocaloid', 'hl-cat-copyright'],
    ['(smile:1.2)', 'hl-w'],
    ['{day|night}', 'hl-alt'],
    ['__hair__', 'hl-wc'],
    ['masterpiece', 'hl-cat-meta'],
    ['glowing eyes', 'hl-new'],
    ['blorptag', 'hl-unk'],
  ];
  return (
    <div
      aria-label="Highlighting preview"
      className={`rounded-[10px] px-3 py-2.5 text-[13.5px] leading-[1.6] ${prefs.highlight ? look.className : ''}`}
      style={{ ...look.style, background: 'var(--s-ground)', border: '1px solid var(--s-line)' }}
    >
      {parts.map(([t, cls], i) => (
        <span key={t}>
          <span className={cls || undefined}>{t}</span>
          {i < parts.length - 1 ? ', ' : ''}
        </span>
      ))}
    </div>
  );
}

type Props = {
  prompt: string;
  /** append: add to the end of the prompt; replace: use as the whole prompt */
  onInsert: (text: string, mode: 'append' | 'replace') => void;
  embeddings: string[];
  prefs: PromptPrefs;
  onPrefs: (p: Partial<PromptPrefs>) => void;
  onClose: () => void;
  /** Phone: render inside a sheet instead of popping out */
  inline?: boolean;
};

/**
 * Pops out beside the controls column: Chunks (saved snippets, recent prompts, wildcards,
 * embeddings) and Settings (tag suggestions and highlighting).
 */
export function PromptPopout({ prompt, onInsert, embeddings, prefs, onPrefs, onClose, inline }: Props) {
  const [tab, setTab] = useState<'chunks' | 'settings'>('chunks');
  const [snippets, setSnippets] = useState<PromptSnippet[]>(loadSnippets);
  const [recent] = useState<string[]>(loadRecentPrompts);
  const [wildcards, setWildcards] = useState<Array<{ name: string; relative: string }>>([]);
  const [naming, setNaming] = useState<string | null>(null);

  useEffect(() => {
    void fetchWildcards()
      .then((r) => setWildcards(r.items))
      .catch(() => setWildcards([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="listbox"]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    const name = (naming ?? '').trim() || prompt.trim().split(',')[0].slice(0, 32) || 'Chunk';
    setSnippets(saveSnippet(name, prompt.trim()));
    setNaming(null);
  };

  return (
    <div
      className={inline ? 'flex flex-col gap-3 px-1' : 'st-popout'}
      data-tip-avoid={inline ? undefined : true}
      data-tip-zone={inline ? undefined : 'right'}
      role={inline ? undefined : 'dialog'}
      aria-label="Prompt chunks and settings"
    >
      <div className="flex items-center gap-2">
        <div className="st-tabs flex-1" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'chunks'} className={tab === 'chunks' ? 'on' : ''} onClick={() => setTab('chunks')}>
            Chunks
          </button>
          <button type="button" role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
            Settings
          </button>
        </div>
        {inline ? null : (
          <button type="button" className="st-ibtn h-9 w-9" onClick={onClose} aria-label="Close" data-tip="Close  ·  Esc">
            <X />
          </button>
        )}
      </div>

      {tab === 'chunks' ? (
        <div className="flex flex-col gap-1.5">
          {snippets.length === 0 ? (
            <p className="m-0 px-1 text-[12.5px]" style={{ color: 'var(--s-muted)' }}>
              Save prompt pieces you reuse — lighting setups, styles, characters — and add them with one click.
            </p>
          ) : null}
          {snippets.map((s) => (
            <div key={s.id} className="flex items-stretch gap-1">
              <button type="button" className="st-listbtn min-w-0 flex-1" onClick={() => onInsert(s.text, 'append')} data-tip="Add to the end of the prompt">
                <span className="text-[13px] font-semibold">{s.name}</span>
                <span className="w-full truncate text-xs" style={{ color: 'var(--s-muted)' }}>
                  {s.text}
                </span>
              </button>
              <button type="button" className="st-ibtn h-auto w-8" onClick={() => setSnippets(deleteSnippet(s.id))} aria-label={`Delete ${s.name}`} data-tip="Delete this chunk">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {naming === null ? (
            <button
              type="button"
              className="st-pill h-9 justify-center border-dashed"
              disabled={!prompt.trim()}
              onClick={() => setNaming(prompt.trim().split(',')[0].slice(0, 32))}
              data-tip="Save the whole prompt as a reusable chunk"
            >
              <Plus className="h-3.5 w-3.5" /> Save current prompt as chunk
            </button>
          ) : (
            <div className="flex gap-1.5">
              <input
                autoFocus
                className="st-search h-9 flex-1"
                value={naming}
                onChange={(e) => setNaming(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save();
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setNaming(null);
                  }
                }}
                placeholder="Chunk name"
                aria-label="Chunk name"
              />
              <button type="button" className="st-pill h-9" style={{ background: 'var(--s-accent)', color: 'var(--s-accent-ink)', borderColor: 'transparent' }} onClick={save}>
                Save
              </button>
            </div>
          )}

          <div className="st-sec px-0.5 pt-2">Recent prompts</div>
          {recent.length === 0 ? (
            <p className="m-0 px-1 text-[12.5px]" style={{ color: 'var(--s-muted)' }}>Prompts you generate with show up here.</p>
          ) : (
            recent.slice(0, 8).map((r) => (
              <button key={r} type="button" className="st-listbtn" onClick={() => onInsert(r, 'replace')} data-tip="Replace the prompt with this">
                <span className="line-clamp-2 text-[12.5px]" style={{ color: 'var(--s-muted)' }}>
                  {r}
                </span>
              </button>
            ))
          )}

          {wildcards.length > 0 ? (
            <>
              <div className="st-sec px-0.5 pt-2">Wildcards</div>
              <div className="flex flex-wrap gap-1.5">
                {wildcards.map((w) => {
                  const token = `__${w.relative.replace(/\.(txt|wildcards?)$/i, '')}__`;
                  return (
                    <button key={w.relative} type="button" className="st-pill h-7 text-xs" onClick={() => onInsert(token, 'append')} data-tip={`Add ${token} — a random line from ${w.relative} each image`}>
                      {token}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {embeddings.length > 0 ? (
            <>
              <div className="st-sec px-0.5 pt-2">Embeddings</div>
              <div className="flex flex-wrap gap-1.5">
                {embeddings.map((name) => (
                  <button key={name} type="button" className="st-pill h-7 text-xs" onClick={() => onInsert(`embedding:${name}`, 'append')} data-tip={`Add embedding:${name}`}>
                    {name}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="st-sec px-0.5 pb-1 pt-0.5">Tag autocomplete</div>
          <div className="st-row">
            <span className="text-[13.5px]">Suggest tags while typing</span>
            <StSwitch on={prefs.autocomplete} onChange={(v) => onPrefs({ autocomplete: v })} label="Suggest tags while typing" tip="Search the tag dictionary as you type (tag-based models)" />
          </div>
          <div className="st-row">
            <span className="text-[13.5px]">Insert tags with</span>
            <div className="w-[170px]">
              <StSeg
                small
                value={prefs.insertFormat}
                onChange={(v) => onPrefs({ insertFormat: v })}
                options={[
                  { value: 'underscores', label: 'red_hair', tip: 'Insert tags with underscores' },
                  { value: 'spaces', label: 'red hair', tip: 'Insert tags with spaces' },
                ]}
              />
            </div>
          </div>

          <div className="st-sec px-0.5 pb-1 pt-2.5">Highlighting</div>
          <div className="st-row">
            <span className="text-[13.5px] font-semibold">Highlight the prompt</span>
            <StSwitch on={prefs.highlight} onChange={(v) => onPrefs({ highlight: v })} label="Highlight the prompt" tip="Turn all prompt highlighting on or off" />
          </div>
          <div className="flex flex-col gap-0.5" style={{ opacity: prefs.highlight ? 1 : 0.45 }}>
            {HL_ROWS.map((r) => {
              const color = r.colorKey ? prefs.hlColors[r.colorKey] : r.key === 'hlNew' ? '#5bd18b' : 'var(--s-muted)';
              return (
                <div key={r.key} className="st-row">
                  <span className="flex min-w-0 flex-col gap-px">
                    <span className="text-[13.5px]">{r.name}</span>
                    <span className="st-mono text-[11.5px]" style={{ color, textDecoration: r.deco ?? 'none', textUnderlineOffset: 3 }}>
                      {r.sample}
                    </span>
                  </span>
                  <span className="flex items-center gap-2.5">
                    {r.colorKey ? (
                      <button
                        type="button"
                        className="st-swatch"
                        style={{ background: prefs.hlColors[r.colorKey] }}
                        disabled={!prefs.highlight}
                        onClick={() => {
                          const key = r.colorKey!;
                          const cur = prefs.hlColors[key];
                          const next = HIGHLIGHT_PALETTE[(HIGHLIGHT_PALETTE.indexOf(cur) + 1) % HIGHLIGHT_PALETTE.length];
                          onPrefs({ hlColors: { ...prefs.hlColors, [key]: next } });
                        }}
                        aria-label={`Change ${r.name.toLowerCase()} colour`}
                        data-tip="Change colour"
                      />
                    ) : null}
                    <StSwitch on={prefs[r.key]} onChange={(v) => onPrefs({ [r.key]: v })} label={r.name} tip={r.tip} disabled={!prefs.highlight} />
                  </span>
                </div>
              );
            })}
          </div>
          <div className="st-lbl px-0.5 pb-1 pt-2">Preview</div>
          <HighlightPreview prefs={prefs} />

          <div className="st-sec px-0.5 pb-1 pt-2.5">Visibility</div>
          <div className="st-row">
            <span className="text-[13.5px]">Show token counter</span>
            <StSwitch on={prefs.tokenCounter} onChange={(v) => onPrefs({ tokenCounter: v })} label="Show token counter" tip="Token count and bar under the prompt" />
          </div>
        </div>
      )}
    </div>
  );
}
