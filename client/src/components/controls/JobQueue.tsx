import { GripVertical, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { GenerationSettings } from '@/types/generation';

export type QueuedJob = {
  id: string;
  settings: GenerationSettings;
  label: string;
};

type Props = {
  jobs: QueuedJob[];
  activeId: string | null;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
};

export function JobQueue({ jobs, activeId, onRemove, onReorder }: Props) {
  if (jobs.length === 0) return null;

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-secondary/20 p-2">
      <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Queue ({jobs.length})
      </p>
      <ul className="flex flex-col gap-1">
        {jobs.map((job, index) => (
          <li
            key={job.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', String(index));
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = Number(e.dataTransfer.getData('text/plain'));
              if (Number.isFinite(from) && from !== index) onReorder(from, index);
            }}
            className={cn(
              'flex items-center gap-1 rounded border bg-background px-1.5 py-1 text-[11px]',
              job.id === activeId ? 'border-primary/50' : 'border-border',
            )}
          >
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{job.label}</span>
            {job.id === activeId && (
              <span className="shrink-0 font-mono text-[9px] text-primary">RUN</span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => onRemove(job.id)}
              aria-label={job.id === activeId ? 'Cancel job' : 'Remove from queue'}
              title={job.id === activeId ? 'Cancel job' : 'Remove from queue'}
            >
              <X className="h-3 w-3" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
