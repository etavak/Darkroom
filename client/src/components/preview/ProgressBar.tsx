import { Progress } from '@/components/ui/progress';

type Props = {
  value: number;
  visible: boolean;
};

export function ProgressBar({ value, visible }: Props) {
  if (!visible) return null;
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="w-full space-y-1.5">
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>Progress</span>
        <span className="font-mono">{Math.round(clamped)}%</span>
      </div>
      <Progress value={clamped} />
    </div>
  );
}
