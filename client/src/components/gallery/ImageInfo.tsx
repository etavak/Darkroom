import type { GenerationRecord } from '@/types/generation';
import { shortModelName } from '@/lib/modelProfiles';
import { Button } from '@/components/ui/button';

type Props = {
  record: GenerationRecord | null;
  onViewSource?: (parentId: string) => void;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2 text-[11px] leading-snug">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-foreground/90">{value}</dd>
    </div>
  );
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

export function ImageInfo({ record, onViewSource }: Props) {
  if (!record) {
    return (
      <div className="border-t border-border px-3 py-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Image info
        </h3>
        <p className="mt-2 text-[11px] text-muted-foreground">Select a generation</p>
      </div>
    );
  }

  const s = record.settings;
  const stack =
    s.modelMode === 'split'
      ? [s.unet, s.clipName, s.clipName2, s.vaeName]
          .filter((x): x is string => Boolean(x))
          .map(shortModelName)
          .join(' · ')
      : [s.checkpoint, s.vaeName ? `VAE ${shortModelName(s.vaeName)}` : '']
          .filter(Boolean)
          .join(' · ');

  const loraLine =
    s.loras && s.loras.length > 0
      ? s.loras.map((l) => `${shortModelName(l.name)} ${l.strength_model}`).join(', ')
      : null;

  const mode = s.generationMode && s.generationMode !== 'txt2img' ? s.generationMode : null;

  return (
    <div className="border-t border-border px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Image info
        </h3>
        {record.parentId ? (
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Derived
          </span>
        ) : null}
      </div>
      <dl className="mt-2 space-y-1.5">
        <Row label="Prompt" value={s.prompt || '—'} />
        {s.negative_prompt ? <Row label="Negative" value={s.negative_prompt} /> : null}
        {mode ? <Row label="Mode" value={mode} /> : null}
        <Row label="Stack" value={stack || '—'} />
        {loraLine ? <Row label="LoRAs" value={loraLine} /> : null}
        <Row label="Seed" value={String(s.seed)} />
        <Row label="Steps" value={String(s.steps)} />
        <Row label="CFG" value={String(s.cfg)} />
        {typeof s.denoise === 'number' ? <Row label="Denoise" value={String(s.denoise)} /> : null}
        {typeof s.guidance === 'number' ? <Row label="Guidance" value={String(s.guidance)} /> : null}
        <Row label="Sampler" value={`${s.sampler} / ${s.scheduler}`} />
        <Row label="Size" value={`${s.width} × ${s.height}`} />
        <Row label="Time" value={formatDuration(record.durationMs)} />
      </dl>
      {record.parentId && onViewSource ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 h-7 w-full text-[11px]"
          onClick={() => onViewSource(record.parentId!)}
        >
          View source
        </Button>
      ) : null}
    </div>
  );
}
