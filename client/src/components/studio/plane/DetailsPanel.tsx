import { useState } from 'react';
import { Copy, X } from 'lucide-react';
import { shortModelName } from '@/lib/modelProfiles';
import type { GenerationRecord } from '@/types/generation';

type Props = {
  record: GenerationRecord | null;
  /** Actual pixel size of the selected image, when known */
  size: { w: number; h: number } | null;
  onClose: () => void;
  onCopy: (text: string, what: string) => void;
  onReuseAll: () => void;
  onReusePrompt: () => void;
};

const MODE_NAMES: Record<string, string> = {
  txt2img: 'Text to image',
  img2img: 'Image to image',
  outpaint: 'Extend',
  edit: 'Edit',
  upscale: 'Upscale',
};

function formatTook(ms: number | null | undefined): string | null {
  if (!ms) return null;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

/** How the selected image was made, with Reuse. Toggle with I. */
export function DetailsPanel({ record, size, onClose, onCopy, onReuseAll, onReusePrompt }: Props) {
  const [showFinal, setShowFinal] = useState(false);
  const s = record?.settings;
  const typed = s ? (s.userPrompt ?? s.promptTemplate ?? s.prompt) : '';
  const typedNeg = s ? (s.userNegative ?? s.negativeTemplate ?? s.negative_prompt) : '';
  const model = s ? shortModelName(s.modelMode === 'split' ? s.unet || s.checkpoint : s.checkpoint) : '';
  const usesGuidance = s ? s.guidance !== undefined && s.guidance !== null && s.cfg <= 1.01 : false;
  const rows: Array<{ k: string; v: string | null | undefined; mono?: boolean }> = s
    ? [
        { k: 'Model', v: model },
        { k: 'Size', v: size ? `${size.w} × ${size.h}` : `${s.width} × ${s.height}`, mono: true },
        { k: 'Seed', v: String(s.seed), mono: true },
        { k: 'Steps', v: String(s.steps), mono: true },
        usesGuidance ? { k: 'Guidance', v: String(s.guidance), mono: true } : { k: 'CFG', v: String(s.cfg), mono: true },
        { k: 'Sampler', v: s.sampler },
        { k: 'Scheduler', v: s.scheduler },
        { k: 'Mode', v: MODE_NAMES[s.generationMode ?? 'txt2img'] ?? s.generationMode },
        s.qualityPreset ? { k: 'Quality', v: s.qualityPreset[0].toUpperCase() + s.qualityPreset.slice(1) } : { k: '', v: null },
        s.negativePreset ? { k: 'Negative', v: s.negativePreset[0].toUpperCase() + s.negativePreset.slice(1) } : { k: '', v: null },
        s.denoise !== undefined && s.generationMode !== 'txt2img' && s.generationMode ? { k: 'Strength', v: String(s.denoise), mono: true } : { k: '', v: null },
        { k: 'Took', v: formatTook(record?.durationMs), mono: true },
        { k: 'Made', v: record ? new Date(record.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null },
      ].filter((r) => r.k && r.v)
    : [];
  const loras = s?.loras?.length ? s.loras.map((l) => `${shortModelName(l.name.replace(/\.(safetensors|ckpt|pt)$/i, ''))} ${l.strength_model}`) : [];
  const finalDiffers = Boolean(s && s.prompt && s.prompt !== typed);

  return (
    <aside className="st-col st-scroll flex w-[300px] shrink-0 flex-col gap-4 px-4 pb-4" style={{ order: 3, borderLeft: '1px solid var(--s-line)' }} data-tip-zone="left" aria-label="Image details">
      <div className="flex h-[62px] shrink-0 items-center justify-between">
        <span className="text-[15px] font-semibold">Details</span>
        <button type="button" className="st-ibtn" onClick={onClose} aria-label="Close details" data-tip="Close details  ·  I">
          <X />
        </button>
      </div>
      {s ? (
        <>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="st-lbl text-[13px]">Prompt</span>
              <button type="button" className="st-ibtn h-8 w-8" onClick={() => onCopy(typed, 'Prompt')} aria-label="Copy prompt" data-tip="Copy prompt">
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <p className="m-0 select-text whitespace-pre-wrap break-words text-[13.5px] leading-normal">{typed || '—'}</p>
            {finalDiffers ? (
              <button type="button" className="mt-1 self-start border-0 bg-transparent p-0 text-xs" style={{ color: 'var(--s-accent)', cursor: 'pointer' }} onClick={() => setShowFinal((v) => !v)}>
                {showFinal ? 'Hide what was sent' : 'Show what was sent (with preset tags)'}
              </button>
            ) : null}
            {showFinal && finalDiffers ? (
              <p className="st-mono m-0 select-text break-words rounded-lg p-2 text-[11.5px] leading-snug" style={{ background: 'var(--s-panel)', color: 'var(--s-muted)' }}>
                {s.prompt}
              </p>
            ) : null}
          </div>
          {typedNeg ? (
            <div className="flex flex-col gap-1">
              <span className="st-lbl text-[13px]">Avoid</span>
              <p className="m-0 select-text break-words text-[13.5px] leading-normal" style={{ color: 'var(--s-muted)' }}>{typedNeg}</p>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            {rows.map((r) => (
              <div key={r.k} className="flex min-w-0 flex-col gap-0.5">
                <span className="st-lbl">{r.k}</span>
                <span className={`select-text text-[13.5px] font-semibold [overflow-wrap:anywhere] ${r.mono ? 'st-mono' : ''}`}>{r.v}</span>
              </div>
            ))}
          </div>
          {loras.length ? (
            <div className="flex flex-col gap-0.5">
              <span className="st-lbl">LoRAs</span>
              {loras.map((l) => (
                <span key={l} className="st-mono text-[12.5px] [overflow-wrap:anywhere]">{l}</span>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            <button type="button" className="st-gen h-10 flex-1 justify-center px-4 text-sm" onClick={onReuseAll} data-tip="Load this image’s prompt, model, size, seed and sampling settings">
              Reuse all settings
            </button>
            <button type="button" className="st-pill h-10" onClick={onReusePrompt} data-tip="Load only the prompt">
              Prompt only
            </button>
          </div>
        </>
      ) : (
        <p className="m-0 text-[13px]" style={{ color: 'var(--s-muted)' }}>Select an image to see how it was made.</p>
      )}
    </aside>
  );
}
