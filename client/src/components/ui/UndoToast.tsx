import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

type Props = {
  message: string;
  open: boolean;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
};

export function UndoToast({
  message,
  open,
  onUndo,
  onDismiss,
  durationMs = 5000,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(id);
  }, [open, durationMs, onDismiss]);

  if (!open) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-[10px] border border-border bg-card px-3 py-2 shadow-lg">
        <p className="text-sm text-foreground">{message}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7"
          onClick={() => {
            onUndo();
          }}
        >
          Undo
        </Button>
      </div>
    </div>
  );
}
