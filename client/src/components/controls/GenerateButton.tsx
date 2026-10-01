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
};

export function GenerateButton({
  onGenerate,
  onCancel,
  running,
  progress = 0,
  progressStep = 0,
  progressMax = 0,
  disabled,
}: Props) {
  if (running) {
    const pct = Math.max(0, Math.min(100, progress));
    const stepLabel =
      progressMax > 0 ? `Step ${progressStep} / ${progressMax}` : `${Math.round(pct)}%`;
    return (
      <button
        type="button"
        onClick={onCancel}
        className="relative h-11 w-full overflow-hidden rounded-md border border-primary/40 bg-secondary text-sm font-semibold tracking-wide text-foreground"
      >
        <span
          className="absolute inset-y-0 left-0 bg-primary/35 transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
        <span className="relative z-10 flex items-center justify-center gap-2">
          Cancel
          <span className="font-mono text-[11px] font-normal text-muted-foreground">
            {stepLabel}
          </span>
        </span>
      </button>
    );
  }

  return (
    <Button
      type="button"
      size="lg"
      className={cn('h-11 w-full font-semibold tracking-wide')}
      onClick={onGenerate}
      disabled={disabled}
    >
      <span>Generate</span>
      <kbd className="ml-2 rounded border border-primary-foreground/25 bg-primary-foreground/10 px-1.5 py-0.5 font-mono text-[10px] font-normal text-primary-foreground/80">
        Ctrl+Enter
      </kbd>
    </Button>
  );
}
