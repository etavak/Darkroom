import { Plus } from 'lucide-react';
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
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  loading?: boolean;
  disabled?: boolean;
  offline?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  hint?: string | null;
  className?: string;
  /** Open the Add model dialog from the bottom of the dropdown */
  onAddModel?: () => void;
  addLabel?: string;
  /** Inline missing-component Add button next to the label */
  missing?: boolean;
  onAddMissing?: () => void;
};

export function ModelSelect({
  label,
  options,
  value,
  onChange,
  loading,
  disabled,
  offline,
  allowEmpty,
  emptyLabel = 'None (auto)',
  hint,
  className,
  onAddModel,
  addLabel = 'Add model…',
  missing,
  onAddMissing,
}: Props) {
  const placeholder = offline
    ? 'Waiting for ComfyUI…'
    : loading
      ? 'Loading…'
      : options.length === 0
        ? 'None found'
        : 'Select…';

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label className={missing ? 'text-destructive' : undefined}>{label}</Label>
        {missing && onAddMissing ? (
          <button
            type="button"
            className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
            onClick={onAddMissing}
          >
            Add
          </button>
        ) : null}
      </div>
      <Select
        value={value || (allowEmpty ? '__empty__' : undefined)}
        onValueChange={(v) => onChange(v === '__empty__' ? '' : v)}
        disabled={disabled || loading || offline || (!allowEmpty && options.length === 0 && !onAddModel)}
      >
        <SelectTrigger className={cn('min-w-0 w-full', missing && 'border-destructive/50')}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {allowEmpty ? (
            <SelectItem value="__empty__">{emptyLabel}</SelectItem>
          ) : null}
          {options.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
          {onAddModel ? (
            <div className="sticky bottom-0 border-t border-border bg-popover p-1">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm text-primary outline-none hover:bg-accent"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAddModel();
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                {addLabel}
              </button>
            </div>
          ) : null}
        </SelectContent>
      </Select>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
