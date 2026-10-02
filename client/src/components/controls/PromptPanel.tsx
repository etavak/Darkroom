import { Lock } from 'lucide-react';
import { PromptToolbar } from '@/components/controls/PromptToolbar';
import { TagChips } from '@/components/controls/TagChips';
import { TagPromptInput } from '@/components/controls/TagPromptInput';
import { Tooltip } from '@/components/ui/tooltip';
import { formatTokenBadge, type PromptTokenMode } from '@/lib/tokens';
import type { InjectedTag } from '@/types/presets';

type Props = {
  prompt: string;
  negativePrompt: string;
  positiveTags: InjectedTag[];
  negativeTags: InjectedTag[];
  disableNegative?: boolean;
  disableNegativeReason?: string;
  familyId: string | null;
  tagsEnabled: boolean;
  tokenMode?: PromptTokenMode;
  tokenMax?: number;
  /** Full prompt used for encoder token count (falls back to user text). */
  finalPositive?: string;
  finalNegative?: string;
  enhanceConfigured?: boolean;
  promptPlaceholder?: string;
  onPromptChange: (v: string) => void;
  onNegativeChange: (v: string) => void;
  onDismissPositive: (tag: string) => void;
  onDismissNegative: (tag: string) => void;
  disabled?: boolean;
};

function TokenBadge({
  mode,
  max,
  presetCount,
  userText,
}: {
  mode: PromptTokenMode;
  max: number;
  presetCount: number;
  userText: string;
}) {
  const { label, over } = formatTokenBadge({
    mode,
    max,
    presetCount,
    userText,
  });
  return (
    <span
      className={
        over
          ? 'pointer-events-none absolute bottom-2 right-2 z-10 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-destructive'
          : 'pointer-events-none absolute bottom-2 right-2 z-10 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground'
      }
    >
      {label}
    </span>
  );
}

export function PromptPanel({
  prompt,
  negativePrompt,
  positiveTags,
  negativeTags,
  disableNegative,
  disableNegativeReason = 'Negatives are unused for this family.',
  familyId,
  tagsEnabled,
  tokenMode = 'clip',
  tokenMax = 75,
  finalPositive,
  finalNegative,
  enhanceConfigured = false,
  promptPlaceholder = 'Describe your image...',
  onPromptChange,
  onNegativeChange,
  onDismissPositive,
  onDismissNegative,
  disabled,
}: Props) {
  const insertIntoPrompt = (text: string, mode: 'replace' | 'append' = 'append') => {
    if (mode === 'replace') {
      onPromptChange(text);
      return;
    }
    const base = prompt.trim();
    onPromptChange(base ? `${base}, ${text}` : text);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="field-label text-[10px]">Positive</p>
          <PromptToolbar
            prompt={prompt}
            onInsert={insertIntoPrompt}
            enhanceConfigured={enhanceConfigured}
            disabled={disabled}
          />
        </div>
        {positiveTags.length > 0 && (
          <div className="space-y-1">
            <p className="field-label text-[10px]">Injected tags</p>
            <TagChips tags={positiveTags} onRemove={onDismissPositive} disabled={disabled} />
          </div>
        )}
        <div className="relative">
          <TagPromptInput
            id="prompt"
            value={prompt}
            onChange={onPromptChange}
            placeholder={promptPlaceholder}
            disabled={disabled}
            familyId={familyId}
            tagsEnabled={tagsEnabled}
            highlightSyntax
            className="min-h-[100px] pb-7"
          />
          <TokenBadge
            mode={tokenMode}
            max={tokenMax}
            presetCount={tokenMode === 'clip' ? positiveTags.length : 0}
            userText={tokenMode === 'clip' ? prompt : finalPositive ?? prompt}
          />
        </div>
      </div>

      {disableNegative ? (
        <Tooltip content={disableNegativeReason} side="bottom">
          <div className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="font-semibold uppercase tracking-wider">Negative prompt</span>
            <span className="ml-auto text-[10px] normal-case tracking-normal opacity-70">Locked</span>
          </div>
        </Tooltip>
      ) : (
        <div className="space-y-1.5">
          <p className="field-label text-[10px]">Negative prompt</p>
          {negativeTags.length > 0 && (
            <div className="space-y-1">
              <p className="field-label text-[10px]">Injected tags</p>
              <TagChips tags={negativeTags} onRemove={onDismissNegative} disabled={disabled} />
            </div>
          )}
          <div className="relative">
            <TagPromptInput
              id="negative"
              value={negativePrompt}
              onChange={onNegativeChange}
              placeholder="What to avoid…"
              disabled={disabled}
              familyId={familyId}
              tagsEnabled={tagsEnabled}
              highlightSyntax
              className="min-h-[64px] pb-7"
            />
            <TokenBadge
              mode={tokenMode}
              max={tokenMax}
              presetCount={tokenMode === 'clip' ? negativeTags.length : 0}
              userText={
                tokenMode === 'clip' ? negativePrompt : finalNegative ?? negativePrompt
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
