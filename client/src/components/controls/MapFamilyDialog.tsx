import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FamilySummary } from '@/types/presets';
import { useState } from 'react';

type Props = {
  open: boolean;
  checkpoint: string;
  families: FamilySummary[];
  onSave: (familyId: string) => Promise<void>;
  onCancel?: () => void;
};

export function MapFamilyDialog({ open, checkpoint, families, onSave }: Props) {
  const [familyId, setFamilyId] = useState(families[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
        <h2 className="text-base font-semibold tracking-tight">Map checkpoint family</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-mono text-foreground">{checkpoint}</span> isn&apos;t mapped yet.
          Pick its base model family — this is saved for next time.
        </p>
        <div className="mt-4 space-y-1.5">
          <Label>Family</Label>
          <Select value={familyId} onValueChange={setFamilyId}>
            <SelectTrigger>
              <SelectValue placeholder="Select family" />
            </SelectTrigger>
            <SelectContent>
              {families.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            disabled={!familyId || saving}
            onClick={() => {
              setSaving(true);
              setError(null);
              void onSave(familyId)
                .catch((err) => {
                  setError(err instanceof Error ? err.message : 'Save failed');
                })
                .finally(() => setSaving(false));
            }}
          >
            {saving ? 'Saving…' : 'Save mapping'}
          </Button>
        </div>
      </div>
    </div>
  );
}
