import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  checkpoints: string[];
  value: string;
  onChange: (v: string) => void;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
};

export function CheckpointSelect({
  checkpoints,
  value,
  onChange,
  loading,
  error,
  disabled,
}: Props) {
  return (
    <div className="space-y-1.5">
      <Label>Checkpoint</Label>
      <Select
        value={value || undefined}
        onValueChange={onChange}
        disabled={disabled || loading || checkpoints.length === 0}
      >
        <SelectTrigger>
          <SelectValue
            placeholder={loading ? 'Loading…' : 'No checkpoints found'}
          />
        </SelectTrigger>
        <SelectContent>
          {checkpoints.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
