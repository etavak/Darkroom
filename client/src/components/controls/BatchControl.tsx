import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  batchSize: number;
  onBatchChange: (v: number) => void;
  disabled?: boolean;
};

export function BatchControl({ batchSize, onBatchChange, disabled }: Props) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="batch">Batch count</Label>
      <Input
        id="batch"
        type="number"
        min={1}
        max={8}
        className="font-mono"
        value={batchSize}
        onChange={(e) => onBatchChange(Number(e.target.value))}
        disabled={disabled}
      />
    </div>
  );
}
