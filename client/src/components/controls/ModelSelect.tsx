import { Info, Plus } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
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
  /** Shown as a tooltip on an info icon next to the label */
  hint?: string | null;
  /** Small chip next to the label (e.g. family name) */
  badge?: string | null;
  className?: string;
  onAddModel?: () => void;
  addLabel?: string;
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
  badge,
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
        <div className="flex min-w-0 items-center gap-1.5">
          <Label className={missing ? 'text-destructive' : undefined}>{label}</Label>
          {badge ? (
            <span className="inline-flex shrink-0 items-center rounded-full border border-primary/35 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-foreground">
              {badge}
            </span>
          ) : null}
          {hint ? (
            <Tooltip content={hint}>
              <button
                type="button"
                className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                aria-label={hint}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          ) : null}
        </div>
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
        disabled={
          disabled || loading || offline || (!allowEmpty && options.length === 0 && !onAddModel)
        }
      >
        <SelectTrigger className={cn('min-w-0 w-full', missing && 'border-destructive/50')}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {allowEmpty ? <SelectItem value="__empty__">{emptyLabel}</SelectItem> : null}
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
    </div>
  );
}
