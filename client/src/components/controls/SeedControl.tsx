import { Dice5, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StepperNumber } from '@/components/ui/stepper-number';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type Props = {
  seed: number;
  locked: boolean;
  onSeedChange: (v: number) => void;
  onLockedChange: (v: boolean) => void;
  disabled?: boolean;
};

const SEED_MAX = 2 ** 32 - 1;

export function SeedControl({ seed, locked, onSeedChange, onLockedChange, disabled }: Props) {
  return (
    <StepperNumber
      id="seed"
      label="Seed"
      value={seed}
      onChange={onSeedChange}
      min={0}
      max={SEED_MAX}
      step={1}
      disabled={disabled || locked}
      trailing={
        <>
          <Tooltip content={locked ? 'Unlock seed' : 'Lock seed'}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={cn(
                'shrink-0',
                locked &&
                  'border-primary bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary',
              )}
              disabled={disabled}
              onClick={() => onLockedChange(!locked)}
              aria-label={locked ? 'Unlock seed' : 'Lock seed'}
            >
              {locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            </Button>
          </Tooltip>
          <Tooltip content="Randomize seed">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              disabled={disabled || locked}
              onClick={() => onSeedChange(Math.floor(Math.random() * 2 ** 32))}
              aria-label="Randomize seed"
            >
              <Dice5 className="h-4 w-4" />
            </Button>
          </Tooltip>
        </>
      }
    />
  );
}
