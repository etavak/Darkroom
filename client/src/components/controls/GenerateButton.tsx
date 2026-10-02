import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  onGenerate: () => void;
  onCancel: () => void;
  running?: boolean;
  progress?: number;
  progressStep?: number;
  progressMax?: number;
  disabled?: boolean;
  /** Shown under the button when Generate is disabled */
  disabledReason?: string | null;
  queueCount?: number;
};

export function GenerateButton({
  onGenerate,
  onCancel,
  running,
  progress = 0,
  progressStep = 0,
  progressMax = 0,
  disabled,
  disabledReason,
  queueCount = 0,
}: Props) {
  if (running) {
    const pct = Math.max(0, Math.min(100, progress));
    const stepLabel =
      progressMax > 0 ? `Step ${progressStep} / ${progressMax}` : `${Math.round(pct)}%`;
    return (
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-11 flex-1 font-semibold tracking-wide"
          onClick={onGenerate}
          disabled={disabled}
        >
          Generate{queueCount > 0 ? ` · ${queueCount}` : ''}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="relative h-11 min-w-[8.5rem] flex-[1.4] overflow-hidden rounded-[10px] border border-primary/40 bg-secondary text-sm font-semibold tracking-wide text-foreground transition-colors duration-150 hover:bg-secondary/80"
        >
          <span
            className="absolute inset-y-0 left-0 bg-primary/35 transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
          <span className="relative z-10 flex items-center justify-center gap-2">
            Cancel
            <span className="font-mono text-[11px] font-normal tabular-nums text-muted-foreground">
              {stepLabel}
            </span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        size="lg"
        className={cn(
          'h-11 w-full font-semibold tracking-wide shadow-[0_0_0_1px_oklch(0.78_0.14_70/0.35),0_8px_24px_-8px_oklch(0.78_0.14_70/0.55)]',
          'bg-primary text-primary-foreground hover:bg-primary/90',
        )}
        onClick={onGenerate}
        disabled={disabled}
      >
        <span>Generate</span>
        <kbd className="ml-2 rounded-[6px] border border-primary-foreground/25 bg-primary-foreground/10 px-1.5 py-0.5 font-mono text-[10px] font-normal tabular-nums text-primary-foreground/80">
          Ctrl+Enter
        </kbd>
      </Button>
      {disabled && disabledReason ? (
        <p className="text-center text-[11px] text-muted-foreground">{disabledReason}</p>
      ) : null}
    </div>
  );
}
