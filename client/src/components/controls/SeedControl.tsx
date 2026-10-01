import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Props = {
  seed: number;
  locked: boolean;
  onSeedChange: (v: number) => void;
  onLockedChange: (v: boolean) => void;
  disabled?: boolean;
};

export function SeedControl({ seed, locked, onSeedChange, onLockedChange, disabled }: Props) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="seed">Seed</Label>
      <div className="flex gap-2">
        <Input
          id="seed"
          type="number"
          className="flex-1 font-mono"
          value={seed}
          onChange={(e) => onSeedChange(Number(e.target.value))}
          disabled={disabled}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'shrink-0',
            locked && 'border-primary bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary',
          )}
          disabled={disabled}
          onClick={() => onLockedChange(!locked)}
        >
          {locked ? 'Locked' : 'Lock'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={disabled || locked}
          onClick={() => onSeedChange(Math.floor(Math.random() * 2 ** 32))}
        >
          Rand
        </Button>
      </div>
    </div>
  );
}
