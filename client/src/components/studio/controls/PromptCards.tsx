import { useState } from 'react';
import { ArrowDownUp, Check, ChevronDown, Dices, Eye, Layers, Lock, Wand2, X } from 'lucide-react';
import { TagPromptInput } from '@/components/controls/TagPromptInput';
import { enhancePromptApi, fetchRandomPrompt } from '@/lib/api';
import type { PromptPrefs } from '@/lib/promptPrefs';
import { estimateTokenCount, type PromptTokenMode } from '@/lib/tokens';
import type { InjectedTag, PresetLevel } from '@/types/presets';
import { StCard, StMenuButton, StMenuItem } from './primitives';
import { randomPrompt } from './randomPrompt';

type PresetPillProps = {
  kind: 'Quality' | 'Negative';
  levels: PresetLevel[];
  value: string | null;
  onPick: (id: string) => void;
  /** Where the tags end up, e.g. "Added to the start of the prompt:" */
  where: string;
  disabled?: boolean;
};

/**
 * The family's preset levels (None / Light / Standard / Heavy…). Hover shows the tags the
 * current level adds; the menu lists every level with its tags. They're never typed into
 * the prompt box.
 */
function PresetPill({ kind, levels, value, onPick, where, disabled }: PresetPillProps) {
  if (levels.length === 0) return null;
  const cur = levels.find((l) => l.id === value) ?? levels[0];
  const tip = cur.tags.length ? `${where}\n${cur.tags.join(', ')}` : `No ${kind.toLowerCase()} tags are added.`;
  return (
    <StMenuButton
      tip={tip}
      label={`${kind}: ${cur.name}`}
      disabled={disabled}
      direction="auto"
      menuStyle={{ left: 'auto', right: 0, width: 270 }}
      button={
        <span className="st-pill">
          {kind}: {cur.name}
          <ChevronDown className="h-3.5 w-3.5" />
        </span>
      }
    >
      {(close) =>
        levels.map((l) => (
          <StMenuItem
            key={l.id}
            title={l.name}
            detail={l.tags.length ? l.tags.join(', ') : 'Nothing added'}
            selected={l.id === cur.id}
            onClick={() => {
              onPick(l.id);
              close();
            }}
          />
        ))
      }
    </StMenuButton>
  );
}

type PromptCardProps = {
  value: string;
  onChange: (v: string) => void;
  familyId: string | null;
  tagsEnabled: boolean;
  placeholder: string;
  disabled?: boolean;
  tokenMode: PromptTokenMode;
  tokenMax: number;
  injected: InjectedTag[];
  qualityLevels: PresetLevel[];
  quality: string | null;
  onQuality: (id: string) => void;
  prefs: PromptPrefs;
  enhanceConfigured: boolean;
  onOpenPreferences: () => void;
  onShowFinal: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
};

export function PromptCard(p: PromptCardProps) {
  const [enhancing, setEnhancing] = useState(false);
  const [enhanced, setEnhanced] = useState<{ before: string; after: string } | null>(null);
  const [compare, setCompare] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing by hand ends the before/after state
  const change = (v: string) => {
    if (enhanced && v !== enhanced.after) setEnhanced(null);
    p.onChange(v);
  };

  const enhance = async () => {
    if (enhancing) return;
    if (!p.enhanceConfigured) {
      setNeedsKey(true);
      return;
    }
    if (!p.value.trim()) return;
    setEnhancing(true);
    setError(null);
    const before = p.value;
    try {
      const res = await enhancePromptApi(before, p.familyId);
      if (res.prompt) {
        p.onChange(res.prompt);
        setEnhanced({ before, after: res.prompt });
        setCompare(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enhance failed');
    } finally {
      setEnhancing(false);
    }
  };

  // Tags Enhance added (tinted until kept)
  const newTags = enhanced
    ? (() => {
        const key = (t: string) => t.trim().replace(/_/g, ' ').toLowerCase();
        const before = new Set(enhanced.before.split(',').map(key));
        return p.value.split(',').filter((t) => t.trim() && !before.has(key(t)));
      })()
    : undefined;

  const tokens = estimateTokenCount(p.value);
  const presetCount = p.tokenMode === 'clip' ? p.injected.length : 0;
  const total = tokens + presetCount;
  const over = total > p.tokenMax;

  return (
    <StCard>
      <div className="flex items-center justify-between pl-4 pr-2 pt-2.5">
        <label htmlFor="prompt" className="text-sm font-semibold">
          Prompt
        </label>
        <div className="flex gap-0.5">
          <button
            type="button"
            className={`st-ibtn ${enhanced ? 'on' : ''}`}
            onClick={() => void enhance()}
            disabled={p.disabled || enhancing}
            aria-label="Enhance prompt with AI"
            data-tip={p.enhanceConfigured ? 'Enhance with AI — rewrites the prompt with more detail' : 'Enhance with AI (needs an API set up in Preferences)'}
          >
            <Wand2 className={enhancing ? 'animate-pulse' : undefined} />
          </button>
          <button
            type="button"
            className="st-ibtn"
            onClick={() =>
              void fetchRandomPrompt(p.familyId)
                .then((r) => change(r.prompt))
                .catch(() => change(randomPrompt(p.tagsEnabled)))
            }
            disabled={p.disabled}
            aria-label="Random prompt"
            data-tip={p.tagsEnabled ? 'Random prompt — tags this model knows' : 'Random prompt'}
          >
            <Dices />
          </button>
          <button
            type="button"
            className={`st-ibtn ${p.panelOpen ? 'on' : ''}`}
            onClick={p.onTogglePanel}
            aria-label="Prompt chunks and settings"
            aria-expanded={p.panelOpen}
            data-tip="Chunks, recent prompts, wildcards and prompt settings"
          >
            <Layers />
          </button>
        </div>
      </div>

      {enhancing ? (
        <div className="st-note mx-3 mt-1.5" role="status">
          <Wand2 className="h-4 w-4 animate-pulse" style={{ color: 'var(--s-accent)' }} />
          Enhancing with AI…
        </div>
      ) : null}
      {enhanced ? (
        <>
          <div className="st-note mx-3 mt-1.5" role="status">
            <Wand2 className="h-4 w-4" style={{ color: '#5bd18b' }} />
            <span className="min-w-0 flex-1">Enhanced</span>
            <button type="button" className="st-pill h-[26px] text-xs" onClick={() => setCompare((c) => !c)} aria-pressed={compare} data-tip="Show the prompt as it was before">
              {compare ? 'Hide before' : 'Compare'}
            </button>
            <button type="button" className="st-pill h-[26px] text-xs" onClick={() => { p.onChange(enhanced.before); setEnhanced(null); }} data-tip="Put the original prompt back">
              Undo
            </button>
            <button type="button" className="st-ibtn h-7 w-7" onClick={() => setEnhanced(null)} aria-label="Keep the enhanced prompt" data-tip="Keep it">
              <Check className="h-4 w-4" />
            </button>
          </div>
          {compare ? (
            <div className="mx-3 mt-1.5 rounded-[10px] px-2.5 py-2 text-[12.5px] leading-normal" style={{ background: 'var(--s-ground)' }}>
              <div className="st-lbl text-[11.5px]">Before</div>
              <div style={{ color: 'var(--s-muted)' }}>{enhanced.before}</div>
            </div>
          ) : null}
        </>
      ) : null}
      {needsKey ? (
        <div className="mx-3 mt-1.5 flex items-start gap-2.5 rounded-[10px] py-2.5 pl-3 pr-1.5" style={{ background: 'var(--s-ground)', border: '1px solid var(--s-line)' }} role="alert">
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13.5px] font-semibold">Enhance needs an AI service</span>
              <span className="text-[12.5px] leading-snug" style={{ color: 'var(--s-muted)' }}>
                Add an OpenAI-compatible URL, key and model in Preferences → Generation.
              </span>
            </div>
            <button type="button" className="st-pill h-7" style={{ background: 'var(--s-accent)', color: 'var(--s-accent-ink)', borderColor: 'transparent' }} onClick={() => { setNeedsKey(false); p.onOpenPreferences(); }}>
              Open Preferences
            </button>
          </div>
          <button type="button" className="st-ibtn h-7 w-7" onClick={() => setNeedsKey(false)} aria-label="Dismiss" data-tip="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="mx-4 mt-1.5 text-xs" style={{ color: '#f0857f' }}>{error}</p>
      ) : null}

      <div className="px-4 pt-1.5">
        <TagPromptInput
          id="prompt"
          bare
          value={p.value}
          onChange={change}
          placeholder={p.placeholder}
          disabled={p.disabled || enhancing}
          familyId={p.familyId}
          tagsEnabled={p.tagsEnabled}
          hl={p.prefs}
          newTags={newTags}
          autocomplete={p.prefs.autocomplete}
          insertFormat={p.prefs.insertFormat}
          className="h-[174px]"
        />
      </div>
      <div className="flex items-center justify-between gap-2 pb-0 pl-4 pr-3 pt-1.5">
        <span className="flex items-center gap-1">
          {p.prefs.tokenCounter ? (
            <span
              className="st-mono text-[11.5px]"
              style={{ color: over ? '#f0857f' : 'var(--s-faint)' }}
              tabIndex={0}
              data-tip={
                p.tokenMode === 'clip'
                  ? `${presetCount} preset + ${tokens} typed. CLIP reads ${p.tokenMax} per chunk; longer prompts are split.`
                  : `About ${tokens} tokens of ${p.tokenMax}.`
              }
            >
              {total} / {p.tokenMax}
            </span>
          ) : null}
          <button type="button" className="st-ibtn h-7 w-7" onClick={p.onShowFinal} aria-label="Show the final prompt" data-tip="Show the final prompt sent to the model">
            <Eye className="h-3.5 w-3.5" />
          </button>
        </span>
        <PresetPill
          kind="Quality"
          levels={p.qualityLevels}
          value={p.quality}
          onPick={p.onQuality}
          where="Added to the start of the prompt:"
          disabled={p.disabled}
        />
      </div>
      {p.prefs.tokenCounter ? (
        <div className="mx-4 mb-3.5 mt-2.5 h-[3px] overflow-hidden rounded-sm" style={{ background: 'var(--s-raised2)' }}>
          <div className="h-full rounded-sm" style={{ width: `${Math.min(100, (total / Math.max(1, p.tokenMax)) * 100)}%`, background: over ? '#f0857f' : 'var(--s-text)' }} />
        </div>
      ) : (
        <div className="h-3.5" />
      )}
    </StCard>
  );
}

type AvoidCardProps = {
  value: string;
  onChange: (v: string) => void;
  familyId: string | null;
  tagsEnabled: boolean;
  disabled?: boolean;
  locked: boolean;
  lockedReason: string;
  levels: PresetLevel[];
  preset: string | null;
  onPreset: (id: string) => void;
  prefs: PromptPrefs;
  onSwap: () => void;
};

export function AvoidCard(p: AvoidCardProps) {
  return (
    <StCard>
      <div className="flex items-center justify-between pl-4 pr-2 pt-2.5">
        <label htmlFor="negative" className="text-sm font-semibold">
          Avoid
        </label>
        {p.locked ? (
          <span className="st-ibtn" style={{ cursor: 'default', color: 'var(--s-faint)' }} data-tip={p.lockedReason} tabIndex={0}>
            <Lock />
          </span>
        ) : (
          <button type="button" className="st-ibtn" onClick={p.onSwap} disabled={p.disabled} aria-label="Swap prompt and avoid" data-tip="Swap with the prompt">
            <ArrowDownUp />
          </button>
        )}
      </div>
      {p.locked ? (
        <p className="mx-4 mb-4 mt-1.5 text-[13px] leading-normal" style={{ color: 'var(--s-muted)' }}>
          {p.lockedReason} Describe what you want in the prompt instead.
        </p>
      ) : (
        <>
          <div className="px-4 pt-1">
            <TagPromptInput
              id="negative"
              bare
              value={p.value}
              onChange={p.onChange}
              placeholder="What to keep out of the image…"
              disabled={p.disabled}
              familyId={p.familyId}
              tagsEnabled={p.tagsEnabled}
              hl={p.prefs}
              autocomplete={p.prefs.autocomplete}
              insertFormat={p.prefs.insertFormat}
              className="h-[75px]"
            />
          </div>
          <div className="flex justify-end px-3 pb-3.5 pt-0.5">
            <PresetPill
              kind="Negative"
              levels={p.levels}
              value={p.preset}
              onPick={p.onPreset}
              where="Added to the negative prompt:"
              disabled={p.disabled}
            />
          </div>
        </>
      )}
    </StCard>
  );
}
