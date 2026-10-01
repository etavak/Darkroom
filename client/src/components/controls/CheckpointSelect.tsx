import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type Props = {
  checkpoints: string[];
  value: string;
  onChange: (v: string) => void;
  loading?: boolean;
  disabled?: boolean;
  offline?: boolean;
  /** Shown inside the checkpoint row when mapped */
  familyName?: string | null;
  mapped?: boolean;
};

export function CheckpointSelect({
  checkpoints,
  value,
  onChange,
  loading,
  disabled,
  offline,
  familyName,
  mapped,
}: Props) {
  const placeholder = offline
    ? 'Waiting for ComfyUI...'
    : loading
      ? 'Loading…'
      : 'No checkpoints found';

  return (
    <div className="space-y-1.5">
      <Label>Checkpoint</Label>
      <div className="flex items-stretch gap-2">
        <Select
          value={value || undefined}
          onValueChange={onChange}
          disabled={disabled || loading || offline || checkpoints.length === 0}
        >
          <SelectTrigger className="min-w-0 flex-1">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {checkpoints.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mapped && familyName ? (
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-[10px] border border-primary/40 bg-primary/10 px-2.5 text-xs font-medium text-foreground',
            )}
            title="Model family"
          >
            {familyName}
          </span>
        ) : null}
      </div>
    </div>
  );
}
