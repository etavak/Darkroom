import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Props = {
  familyName: string | null;
  mapped: boolean;
  baseRes?: number;
};

export function FamilyBadge({ familyName, mapped, baseRes }: Props) {
  return (
    <div className="space-y-1.5">
      <Label>Family</Label>
      <div
        className={cn(
          'flex h-9 items-center justify-between rounded-md border px-3 text-sm',
          mapped
            ? 'border-primary/40 bg-primary/10 text-foreground'
            : 'border-dashed border-border bg-muted/30 text-muted-foreground',
        )}
      >
        <span className="font-medium">{mapped ? familyName : 'Unmapped checkpoint'}</span>
        {mapped && typeof baseRes === 'number' && (
          <span className="font-mono text-[11px] text-muted-foreground">{baseRes}px</span>
        )}
      </div>
    </div>
  );
}
