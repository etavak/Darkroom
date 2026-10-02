import { Label } from '@/components/ui/label';
import { TagChips } from '@/components/controls/TagChips';
import { TagPromptInput } from '@/components/controls/TagPromptInput';
import { estimateTokenCount } from '@/lib/tokens';
import type { InjectedTag } from '@/types/presets';

type Props = {
  prompt: string;
  negativePrompt: string;
  positiveTags: InjectedTag[];
  negativeTags: InjectedTag[];
  disableNegative?: boolean;
  familyId: string | null;
  tagsEnabled: boolean;
  finalPositive?: string;
  finalNegative?: string;
  onPromptChange: (v: string) => void;
  onNegativeChange: (v: string) => void;
  onDismissPositive: (tag: string) => void;
  onDismissNegative: (tag: string) => void;
  disabled?: boolean;
};

function TokenBadge({ text }: { text: string }) {
  const count = estimateTokenCount(text);
  const over = count > 75;
  return (
    <span
      className={
        over
          ? 'pointer-events-none absolute bottom-2 right-2 z-10 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-destructive'
          : 'pointer-events-none absolute bottom-2 right-2 z-10 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground'
      }
    >
      {count} / 75
    </span>
  );
}

export function PromptPanel({
  prompt,
  negativePrompt,
  positiveTags,
  negativeTags,
  disableNegative,
  familyId,
  tagsEnabled,
  finalPositive,
  finalNegative,
  onPromptChange,
  onNegativeChange,
  onDismissPositive,
  onDismissNegative,
  disabled,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
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
            placeholder="Describe your image..."
            disabled={disabled}
            familyId={familyId}
            tagsEnabled={tagsEnabled}
            className="min-h-[100px] pb-7"
          />
          <TokenBadge text={finalPositive ?? prompt} />
        </div>
      </div>
      {!disableNegative && (
        <div className="space-y-1.5">
          <Label htmlFor="negative">Negative prompt</Label>
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
              className="min-h-[64px] pb-7"
            />
            <TokenBadge text={finalNegative ?? negativePrompt} />
          </div>
        </div>
      )}
      {disableNegative && (
        <p className="text-[11px] text-muted-foreground">
          Negatives disabled for this family (Flux).
        </p>
      )}
    </div>
  );
}
