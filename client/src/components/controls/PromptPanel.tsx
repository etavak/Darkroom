import { Label } from '@/components/ui/label';
import { TagChips } from '@/components/controls/TagChips';
import { TagPromptInput } from '@/components/controls/TagPromptInput';
import type { InjectedTag } from '@/types/presets';

type Props = {
  prompt: string;
  negativePrompt: string;
  positiveTags: InjectedTag[];
  negativeTags: InjectedTag[];
  disableNegative?: boolean;
  familyId: string | null;
  tagsEnabled: boolean;
  onPromptChange: (v: string) => void;
  onNegativeChange: (v: string) => void;
  onDismissPositive: (tag: string) => void;
  onDismissNegative: (tag: string) => void;
  disabled?: boolean;
};

export function PromptPanel({
  prompt,
  negativePrompt,
  positiveTags,
  negativeTags,
  disableNegative,
  familyId,
  tagsEnabled,
  onPromptChange,
  onNegativeChange,
  onDismissPositive,
  onDismissNegative,
  disabled,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="prompt">Prompt</Label>
        {positiveTags.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Injected tags
            </p>
            <TagChips tags={positiveTags} onRemove={onDismissPositive} disabled={disabled} />
          </div>
        )}
        <TagPromptInput
          id="prompt"
          value={prompt}
          onChange={onPromptChange}
          placeholder="Your text (appended after preset tags)…"
          disabled={disabled}
          familyId={familyId}
          tagsEnabled={tagsEnabled}
          className="min-h-[100px]"
        />
      </div>
      {!disableNegative && (
        <div className="space-y-1.5">
          <Label htmlFor="negative">Negative prompt</Label>
          {negativeTags.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Injected tags
              </p>
              <TagChips tags={negativeTags} onRemove={onDismissNegative} disabled={disabled} />
            </div>
          )}
          <TagPromptInput
            id="negative"
            value={negativePrompt}
            onChange={onNegativeChange}
            placeholder="Your negatives…"
            disabled={disabled}
            familyId={familyId}
            tagsEnabled={tagsEnabled}
            className="min-h-[64px]"
          />
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
