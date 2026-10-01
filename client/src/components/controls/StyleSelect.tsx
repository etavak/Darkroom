import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FamilyStyleSummary } from '@/types/presets';

type Props = {
  styles: FamilyStyleSummary[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
};

export function StyleSelect({ styles, value, onChange, disabled }: Props) {
  return (
    <div className="space-y-1.5">
      <Label>Style</Label>
      <Select
        value={value ?? undefined}
        onValueChange={onChange}
        disabled={disabled || styles.length === 0}
      >
        <SelectTrigger>
          <SelectValue placeholder={styles.length ? 'Select style' : 'No family styles'} />
        </SelectTrigger>
        <SelectContent>
          {styles.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
