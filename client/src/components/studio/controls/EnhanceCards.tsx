import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Check, ChevronDown, ExternalLink, GripVertical, Info, Plus, TriangleAlert, X } from 'lucide-react';
import { fetchControlNetJob, installFaceModelApi, lookupLoraOnCivitai, loraThumbUrl, type ControlNetInstallJob, type LoraMeta } from '@/lib/api';
import { loraFit, promptHasTag, togglePromptTag } from '@/lib/loraFit';
import { shortModelName } from '@/lib/modelProfiles';
import type { DetailerSettings, HiresFixSettings, LoraSettings } from '@/types/generation';
import { StCard, StCardBtn, StMenuButton, StMenuItem, StSeg, StSlider, StSwitch } from './primitives';

const MAX_LORAS = 8;

/** File name without folder or extension */
const loraLabel = (name: string) => shortModelName(name.replace(/\.(safetensors|ckpt|pt|bin|gguf)$/i, ''));

/** Folder part of a model path ("" at the top level) */
function folderOf(name: string): string {
  const i = name.replace(/\\/g, '/').lastIndexOf('/');
  return i > 0 ? name.slice(0, i) : '';
}

/** Preview image, or the name's first letter */
function LoraThumb({ name, meta }: { name: string; meta?: LoraMeta }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="st-lthumb" aria-hidden>
      {meta?.thumb && !broken ? (
        <img src={loraThumbUrl(name)} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
      ) : (
        loraLabel(name).slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

/** "Illustrious · folder" under a LoRA's name */
function loraSubline(name: string, meta?: LoraMeta): string {
  return [meta?.base, folderOf(name)].filter(Boolean).join(' · ');
}

/** What each LoRA was made for, trigger words and preview, plus the current model to check against */
export type LoraContext = {
  meta: Record<string, LoraMeta>;
  familyId: string | null;
  familyName: string | null;
  /** A LoRA's details changed (e.g. found on Civitai) */
  onMeta?: (m: LoraMeta) => void;
};

const sizeLabel = (n?: number) => (!n ? null : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

/**
 * Everything the file says about itself: base, type, rank, training size, trigger words,
 * style tokens and the tags it was trained on (click to add to the prompt), and its
 * Civitai page — or "Find on Civitai" to look it up by hash.
 */
function LoraDetails({ name, meta, prompt, onPrompt, onMeta, disabled }: { name: string; meta?: LoraMeta; prompt?: string; onPrompt?: (next: string) => void; onMeta?: (m: LoraMeta) => void; disabled?: boolean }) {
  const [lookup, setLookup] = useState<'idle' | 'busy' | string>('idle');
  if (!meta) return <p className="m-0 text-xs" style={{ color: 'var(--s-muted)' }}>No details — the file isn’t in a loras folder Darkroom can read.</p>;
  const facts = [meta.base ? `Made for ${meta.base}` : 'Base unknown', meta.network, meta.rank ? `rank ${meta.rank}` : null, meta.resolution, sizeLabel(meta.sizeBytes)].filter(Boolean);
  const training = [meta.trainImages ? `${meta.trainImages.toLocaleString()} images` : null, meta.epochs ? `${meta.epochs} epochs` : null].filter(Boolean);
  const tags = meta.trainedTags ?? [];
  const styleTags = tags.filter((t) => /^@[a-z0-9]/i.test(t.tag)).slice(0, 10);
  const otherTags = tags.filter((t) => !/^@[a-z0-9]/i.test(t.tag)).slice(0, 12);
  const chip = (t: string, count?: number) => {
    const inPrompt = prompt !== undefined && promptHasTag(prompt, t);
    return onPrompt && prompt !== undefined ? (
      <button key={t} type="button" className={`st-trig ${inPrompt ? 'on' : ''}`} disabled={disabled} aria-pressed={inPrompt} onClick={() => onPrompt(togglePromptTag(prompt, t))} data-tip={`${inPrompt ? 'In the prompt — click to remove' : 'Add to the prompt'}${count ? ` · used ${count.toLocaleString()}× in training` : ''}`}>
        {inPrompt ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
        <span className="truncate">{t}</span>
      </button>
    ) : (
      <span key={t} className="st-trig" style={{ cursor: 'default' }} data-tip={count ? `Used ${count.toLocaleString()}× in training` : undefined}>
        <span className="truncate">{t}</span>
      </span>
    );
  };
  return (
    <div className="flex flex-col gap-2 text-[12.5px]" style={{ color: 'var(--s-muted)' }}>
      {meta.title && meta.title.toLowerCase() !== loraLabel(name).toLowerCase() ? <span className="font-semibold" style={{ color: 'var(--s-text)' }}>{meta.title}</span> : null}
      <span>{facts.join(' · ')}</span>
      {training.length ? <span>Trained on {training.join(' · ')}</span> : null}
      {meta.triggers.length ? (
        <div className="flex flex-col gap-1">
          <span className="st-sec" style={{ fontSize: 10.5 }}>Trigger words</span>
          <div className="flex flex-wrap gap-1.5">{meta.triggers.map((t) => chip(t))}</div>
        </div>
      ) : null}
      {styleTags.length ? (
        <div className="flex flex-col gap-1">
          <span className="st-sec" style={{ fontSize: 10.5 }} data-tip="Style tokens from the training captions — each one calls up a trained style">Styles</span>
          <div className="flex flex-wrap gap-1.5">{styleTags.map((t) => chip(t.tag, t.count))}</div>
        </div>
      ) : null}
      {otherTags.length ? (
        <div className="flex flex-col gap-1">
          <span className="st-sec" style={{ fontSize: 10.5 }} data-tip="The tags used most in the training captions — the LoRA responds best to these">Trained with</span>
          <div className="flex flex-wrap gap-1.5">{otherTags.map((t) => chip(t.tag, t.count))}</div>
        </div>
      ) : null}
      {!meta.triggers.length && !tags.length ? <span>No trigger words or training tags saved in this file.</span> : null}
      <div className="flex flex-wrap items-center gap-2">
        {meta.sourceUrl ? (
          <a href={meta.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1" style={{ color: 'var(--s-accent)' }}>
            Civitai page <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
        {!meta.civitai ? (
          <button
            type="button"
            className="st-pill h-[26px] text-xs"
            disabled={disabled || lookup === 'busy'}
            data-tip="Looks the file up on Civitai by its fingerprint (SHA256) and saves its preview, trigger words and page next to it. Large files take a few seconds."
            onClick={() => {
              setLookup('busy');
              lookupLoraOnCivitai(name)
                .then((r) => {
                  if (r.meta) onMeta?.(r.meta);
                  setLookup(r.found ? 'Found — preview and trigger words saved' : 'Not on Civitai (or not public)');
                })
                .catch((e: unknown) => setLookup(e instanceof Error ? e.message : 'Lookup failed'));
            }}
          >
            {lookup === 'busy' ? 'Looking up…' : 'Find on Civitai'}
          </button>
        ) : null}
        {lookup !== 'idle' && lookup !== 'busy' ? <span>{lookup}</span> : null}
      </div>
    </div>
  );
}

type LoraCardProps = LoraContext & {
  loras: LoraSettings[];
  onChange: (l: LoraSettings[]) => void;
  /** Trigger-word chips add to / remove from the prompt */
  prompt: string;
  onPrompt: (next: string) => void;
  pickerOpen: boolean;
  onPickerOpen: (open: boolean) => void;
  disabled?: boolean;
};

/** Stacked LoRAs: on/off, weight, remove, drag the grip (or ↑↓ on it) to reorder. */
export function LoraCard({ loras, onChange, pickerOpen, onPickerOpen, disabled, meta, familyId, familyName, prompt, onPrompt, onMeta }: LoraCardProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const on = loras.filter((l) => l.enabled !== false).length;

  const update = (i: number, patch: Partial<LoraSettings>) => onChange(loras.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= loras.length) return;
    const next = [...loras];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };

  const rowAt = (y: number) => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-lora-row]') ?? []);
    const idx = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });
    return idx === -1 ? rows.length - 1 : idx;
  };
  const gripDown = (i: number) => (e: PointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.dataset.stDragging = '1';
    setDrag({ from: i, over: i });
  };
  const gripMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (!drag) return;
    const over = rowAt(e.clientY);
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const gripUp = () => {
    if (!drag) return;
    delete document.body.dataset.stDragging;
    move(drag.from, drag.over);
    setDrag(null);
  };
  const gripKey = (i: number) => (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(i, e.key === 'ArrowUp' ? i - 1 : i + 1);
    }
  };

  return (
    <StCard>
      <div className="flex items-center gap-3 py-2.5 pl-4 pr-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">LoRAs</div>
          <div className="truncate text-[13px]" style={{ color: 'var(--s-muted)' }}>
            {loras.length ? `${loras.length} added · ${on} on` : 'None added'}
          </div>
        </div>
        <StCardBtn
          label="Add a LoRA"
          tip={loras.length >= MAX_LORAS ? `Up to ${MAX_LORAS} LoRAs` : 'Add a LoRA'}
          active={pickerOpen}
          disabled={disabled}
          onClick={() => onPickerOpen(!pickerOpen)}
        >
          <Plus />
        </StCardBtn>
      </div>
      <div ref={listRef}>
        {loras.map((l, i) => {
          const enabled = l.enabled !== false;
          const dragging = drag?.from === i;
          const target = drag && drag.over === i && drag.from !== i;
          return (
            <div
              key={`${l.name}-${i}`}
              data-lora-row
              className="flex flex-col gap-2 pb-3 pl-1.5 pr-2.5 pt-2.5"
              style={{
                borderTop: `1px solid ${target ? 'var(--s-accent)' : 'var(--s-line)'}`,
                opacity: dragging ? 0.5 : enabled ? 1 : 0.55,
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Reorder ${loraLabel(l.name)}`}
                  data-tip="Drag to reorder (or ↑↓) — LoRAs apply top to bottom"
                  className="inline-flex px-0.5 py-1.5"
                  style={{ color: 'var(--s-faint)', cursor: drag ? 'grabbing' : 'grab', touchAction: 'none' }}
                  onPointerDown={gripDown(i)}
                  onPointerMove={gripMove}
                  onPointerUp={gripUp}
                  onPointerCancel={gripUp}
                  onKeyDown={gripKey(i)}
                  onDragStart={(e) => e.preventDefault()}
                >
                  <GripVertical className="pointer-events-none h-4 w-4" />
                </span>
                <LoraThumb name={l.name} meta={meta[l.name]} />
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-sm font-semibold" data-tip={meta[l.name]?.title ? `${meta[l.name]?.title}\n${l.name}` : l.name}>
                    {loraLabel(l.name)}
                  </span>
                  {loraSubline(l.name, meta[l.name]) ? (
                    <span className="truncate text-xs" style={{ color: 'var(--s-muted)' }}>
                      {loraSubline(l.name, meta[l.name])}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={`st-ibtn h-[30px] w-[30px] ${open === l.name ? 'on' : ''}`}
                  onClick={() => setOpen(open === l.name ? null : l.name)}
                  aria-expanded={open === l.name}
                  aria-label={`Details for ${loraLabel(l.name)}`}
                  data-tip="Details — base, training tags, Civitai"
                >
                  <Info className="h-4 w-4" />
                </button>
                <StSwitch
                  size="sm"
                  on={enabled}
                  onChange={(v) => update(i, { enabled: v })}
                  label={`Use ${loraLabel(l.name)}`}
                  tip={enabled ? 'On — click to skip it without removing' : 'Off — click to use it again'}
                  disabled={disabled}
                />
                <button
                  type="button"
                  className="st-ibtn h-[30px] w-[30px]"
                  onClick={() => onChange(loras.filter((_, j) => j !== i))}
                  disabled={disabled}
                  aria-label={`Remove ${loraLabel(l.name)}`}
                  data-tip="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2.5 pl-[26px]" data-tip="Weight — 1 is full strength, below 0 pushes the opposite way">
                <input
                  className="st-rng"
                  type="range"
                  min={-1}
                  max={2}
                  step={0.05}
                  value={l.strength_model}
                  disabled={disabled}
                  aria-label={`Weight for ${loraLabel(l.name)}`}
                  onChange={(e) => {
                    const w = Number(e.target.value);
                    update(i, { strength_model: w, strength_clip: w });
                  }}
                  onDoubleClick={() => update(i, { strength_model: 1, strength_clip: 1 })}
                />
                <span className="st-mono w-[42px] text-right text-[13px] font-semibold">{l.strength_model.toFixed(2)}</span>
              </div>
              {(() => {
                const fit = loraFit(meta[l.name], familyId, familyName);
                return fit.note ? (
                  <div className="flex items-start gap-1.5 pl-[26px] text-[12.5px] leading-snug" style={{ color: '#e2b44f' }} role="note">
                    <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                    <span>{fit.note}</span>
                  </div>
                ) : null;
              })()}
              {open === l.name ? (
                <div className="pl-[26px]">
                  <LoraDetails name={l.name} meta={meta[l.name]} prompt={prompt} onPrompt={onPrompt} onMeta={onMeta} disabled={disabled} />
                </div>
              ) : meta[l.name]?.triggers.length ? (
                <div className="flex flex-wrap gap-1.5 pl-[26px]">
                  {meta[l.name].triggers.map((t) => {
                    const inPrompt = promptHasTag(prompt, t);
                    return (
                      <button
                        key={t}
                        type="button"
                        className={`st-trig ${inPrompt ? 'on' : ''}`}
                        disabled={disabled}
                        aria-pressed={inPrompt}
                        onClick={() => onPrompt(togglePromptTag(prompt, t))}
                        data-tip={inPrompt ? 'In the prompt — click to remove it' : 'Trigger word — click to add it to the prompt'}
                      >
                        {inPrompt ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                        <span className="truncate">{t}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </StCard>
  );
}

type LoraPickerProps = LoraContext & {
  options: string[];
  loras: LoraSettings[];
  onAdd: (name: string) => void;
  onAddModel: () => void;
  onClose: () => void;
  loading?: boolean;
  /** Phone: render inside a sheet instead of popping out */
  inline?: boolean;
};

/** Pops out beside the controls column: search the installed LoRAs and add them. */
export function LoraPicker({ options, loras, onAdd, onAddModel, onClose, loading, inline, meta, familyId, familyName, onMeta }: LoraPickerProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [show, setShow] = useState<'compatible' | 'all'>('compatible');
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const added = new Set(loras.map((l) => l.name));
  const full = loras.length >= MAX_LORAS;
  const fits = (o: string) => {
    const k = loraFit(meta[o], familyId, familyName).kind;
    return k === 'ok' || k === 'unknown';
  };
  const compatibleCount = options.filter(fits).length;
  const needle = q.trim().toLowerCase();
  const hits = options.filter(
    (o) =>
      (show === 'all' || fits(o)) &&
      (!needle || o.toLowerCase().includes(needle) || (meta[o]?.title ?? '').toLowerCase().includes(needle) || (meta[o]?.base ?? '').toLowerCase().includes(needle)),
  );

  return (
    <div
      className={inline ? 'flex flex-col gap-3 px-1' : 'st-popout'}
      data-tip-avoid={inline ? undefined : true}
      data-tip-zone={inline ? undefined : 'right'}
      role={inline ? undefined : 'dialog'}
      aria-label="Add a LoRA"
    >
      {inline ? null : (
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold">Add a LoRA</span>
          <button type="button" className="st-ibtn h-9 w-9" onClick={onClose} aria-label="Close" data-tip="Close  ·  Esc">
            <X />
          </button>
        </div>
      )}
      <input
        autoFocus={!inline}
        className="st-search h-[38px]"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search LoRAs"
        aria-label="Search LoRAs"
      />
      {options.length ? (
        <StSeg
          small
          value={show}
          onChange={setShow}
          options={[
            { value: 'compatible', label: `Compatible · ${compatibleCount}`, tip: familyName ? `Made for ${familyName} (or unknown)` : 'Made for the current model (or unknown)' },
            { value: 'all', label: `All · ${options.length}`, tip: 'Every installed LoRA, including ones made for other models' },
          ]}
        />
      ) : null}
      <div className="flex flex-col gap-1.5">
        {loading ? (
          <p className="m-0 px-0.5 text-[13px]" style={{ color: 'var(--s-muted)' }}>Loading…</p>
        ) : options.length === 0 ? (
          <p className="m-0 px-0.5 text-[13px]" style={{ color: 'var(--s-muted)' }}>No LoRAs installed yet.</p>
        ) : hits.length === 0 ? (
          <p className="m-0 px-0.5 text-[13px]" style={{ color: 'var(--s-muted)' }}>
            {show === 'compatible' && !needle ? `None of your LoRAs are made for ${familyName ?? 'this model'}. See All.` : 'No LoRAs match.'}
          </p>
        ) : (
          hits.map((name) => {
            const isAdded = added.has(name);
            const fit = loraFit(meta[name], familyId, familyName);
            const sub = loraSubline(name, meta[name]);
            return (
              <div key={name} className="flex flex-col gap-1.5">
              <div className="flex items-stretch gap-1.5">
              <button
                type="button"
                className="st-listbtn min-w-0 flex-1 flex-row items-center gap-3"
                disabled={isAdded || full}
                style={{ opacity: isAdded ? 0.55 : 1 }}
                onClick={() => onAdd(name)}
                data-tip={isAdded ? 'Already added' : full ? `Up to ${MAX_LORAS} LoRAs` : fit.note ? `${name}\n${fit.note}` : name}
              >
                <LoraThumb name={name} meta={meta[name]} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold">{loraLabel(name)}</span>
                  {sub ? (
                    <span className="truncate text-xs" style={{ color: 'var(--s-muted)' }}>
                      {sub}
                    </span>
                  ) : null}
                  {fit.note ? (
                    <span className="flex items-center gap-1 text-xs" style={{ color: '#e2b44f' }}>
                      <TriangleAlert className="h-3 w-3 shrink-0" />
                      <span className="truncate">{fit.kind === 'wrong-arch' ? `Made for ${meta[name]?.base ?? 'another model'} — won’t work here` : `Made for ${meta[name]?.base}`}</span>
                    </span>
                  ) : null}
                </span>
                {isAdded ? (
                  <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--s-muted)' }}>
                    <Check className="h-3.5 w-3.5" /> Added
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className={`st-ibtn w-9 shrink-0 self-stretch ${open === name ? 'on' : ''}`}
                style={{ height: 'auto' }}
                onClick={() => setOpen(open === name ? null : name)}
                aria-expanded={open === name}
                aria-label={`Details for ${loraLabel(name)}`}
                data-tip="Details — base, training tags, Civitai"
              >
                <Info className="h-4 w-4" />
              </button>
              </div>
              {open === name ? (
                <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--s-panel)', border: '1px solid var(--s-line)' }}>
                  <LoraDetails name={name} meta={meta[name]} onMeta={onMeta} />
                </div>
              ) : null}
              </div>
            );
          })
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs" style={{ color: 'var(--s-faint)' }}>LoRAs live in models/loras.</span>
        <button type="button" className="st-pill h-7 text-xs" onClick={onAddModel} data-tip="Download or import a LoRA file">
          <Plus className="h-3.5 w-3.5" /> Add file
        </button>
      </div>
    </div>
  );
}

type ExtrasProps = {
  hires: HiresFixSettings;
  onHires: (v: HiresFixSettings) => void;
  /** Hires fix only runs on new images (not image to image) */
  hiresApplies: boolean;
  detailer: DetailerSettings;
  onDetailer: (v: DetailerSettings) => void;
  detectors: string[];
  detailerAvailable: boolean;
  /** What the face detailer still needs */
  detailerMissing?: 'impact-pack' | 'impact-subpack' | 'face-model' | null;
  /** The face finder finished downloading (reload the model list) */
  onModelsChanged?: () => void;
  disabled?: boolean;
};

const DETAILER_MISSING = {
  'impact-pack': { sub: 'Needs Impact Pack', tip: 'In the launcher choose Face detailer — it installs Impact Pack, Impact Subpack and the face finder. Then restart ComfyUI.' },
  'impact-subpack': { sub: 'Needs Impact Subpack', tip: 'Impact Subpack finds the faces. In the launcher choose Face detailer, then restart ComfyUI (Stop everything → Start Darkroom).' },
  'face-model': { sub: 'Needs the face finder (52 MB)', tip: 'Install the face model below, or in the launcher’s Face detailer.' },
} as const;

/** Hires fix and Face detailer: a switch each, their settings underneath while on. */
export function ExtrasCard(p: ExtrasProps) {
  const [faceJob, setFaceJob] = useState<ControlNetInstallJob | null>(null);
  const [faceError, setFaceError] = useState<string | null>(null);
  const { onModelsChanged } = p;
  useEffect(() => {
    if (!faceJob || faceJob.status !== 'running') return;
    const t = window.setInterval(() => {
      fetchControlNetJob(faceJob.id)
        .then((j) => {
          setFaceJob(j);
          if (j.status === 'done') onModelsChanged?.();
          if (j.status === 'error') setFaceError(j.error ?? 'Download failed');
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(t);
  }, [faceJob, onModelsChanged]);
  const missing = p.detailerAvailable ? null : (p.detailerMissing ?? 'impact-pack');
  const h = p.hires;
  const d = p.detailer;
  const dOn = d.enabled && p.detailerAvailable;
  const detectors = p.detectors.length ? p.detectors : [d.detector || 'bbox/face_yolov8m.pt'];

  return (
    <StCard>
      <div className="flex items-center gap-3 py-3 pl-4 pr-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Hires fix</div>
          <div className="text-[13px]" style={{ color: 'var(--s-muted)' }}>
            {p.hiresApplies ? `Renders at ${h.scale}× then refines — sharper detail` : 'Only for new images, not image to image'}
          </div>
        </div>
        <StSwitch
          on={h.enabled}
          onChange={(v) => p.onHires({ ...h, enabled: v })}
          label="Hires fix"
          tip="Makes the image at the normal size, enlarges it, then runs a second, lighter pass at the bigger size — more detail without the doubled limbs you get from generating big directly. Slower."
          disabled={p.disabled}
        />
      </div>
      {h.enabled ? (
        <div className="flex flex-col gap-3 px-4 pb-3.5" style={{ opacity: p.hiresApplies ? 1 : 0.55 }}>
          <StSlider label="Scale" value={h.scale} onChange={(v) => p.onHires({ ...h, scale: v })} min={1.1} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} resetTo={1.5} tip="How much bigger the second pass is" disabled={p.disabled} />
          <div className="grid grid-cols-2 gap-3">
            <StSlider small label="Steps" value={h.steps} onChange={(v) => p.onHires({ ...h, steps: v })} min={1} max={60} step={1} resetTo={15} tip="Steps for the second pass" disabled={p.disabled} />
            <StSlider small label="Strength" value={h.denoise} onChange={(v) => p.onHires({ ...h, denoise: v })} min={0.05} max={1} step={0.05} format={(v) => v.toFixed(2)} resetTo={0.45} tip="How much the second pass may change — low keeps the composition" disabled={p.disabled} />
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3 py-3 pl-4 pr-3" style={{ borderTop: '1px solid var(--s-line)' }}>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Face detailer</div>
          <div className="text-[13px]" style={{ color: 'var(--s-muted)' }}>
            {missing ? DETAILER_MISSING[missing].sub : 'Finds faces and redraws them sharper'}
          </div>
        </div>
        <StSwitch
          on={dOn}
          onChange={(v) => p.onDetailer({ ...d, enabled: v })}
          label="Face detailer"
          tip={missing ? DETAILER_MISSING[missing].tip : 'After the image is made, finds each face and redraws it at a higher resolution — fixes small, blurry faces'}
          disabled={p.disabled || !p.detailerAvailable}
        />
      </div>
      {missing ? (
        <div className="flex flex-col gap-2 px-4 pb-3.5">
          {missing === 'face-model' ? (
            faceJob && faceJob.status !== 'error' ? (
              <span className="text-[12.5px]">
                {faceJob.status === 'done' ? 'Face finder installed.' : `Downloading the face finder… ${Math.floor(faceJob.progress)}%`}
              </span>
            ) : (
              <button
                type="button"
                className="st-pill st-pill-accent h-[28px] self-start text-xs"
                disabled={p.disabled}
                onClick={() => {
                  setFaceError(null);
                  installFaceModelApi()
                    .then(setFaceJob)
                    .catch((e: unknown) => setFaceError(e instanceof Error ? e.message : 'Download failed'));
                }}
                data-tip="face_yolov8m.pt from Bingsu/adetailer (Apache-2.0), checked against its sha256"
              >
                Install face finder · 52 MB
              </button>
            )
          ) : (
            <span className="text-[12.5px] leading-snug" style={{ color: 'var(--s-muted)' }}>
              {DETAILER_MISSING[missing].tip}
            </span>
          )}
          {faceError ? <span className="text-[12px]" style={{ color: '#f0857f' }}>{faceError}</span> : null}
        </div>
      ) : null}
      {dOn ? (
        <div className="flex flex-col gap-3 px-4 pb-3.5">
          {detectors.length > 1 ? (
            <div className="st-row">
              <span className="text-[13px]">Detect</span>
              <StMenuButton
                tip="What to find and redraw"
                label="Detector"
                disabled={p.disabled}
                direction="auto"
                menuStyle={{ left: 'auto', right: 0, width: 260 }}
                button={
                  <span className="st-pill">
                    <span className="max-w-[150px] truncate">{shortModelName(d.detector || detectors[0])}</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </span>
                }
              >
                {(close) =>
                  detectors.map((x) => (
                    <StMenuItem
                      key={x}
                      title={shortModelName(x)}
                      detail={folderOf(x) || undefined}
                      selected={x === (d.detector || detectors[0])}
                      onClick={() => {
                        p.onDetailer({ ...d, detector: x });
                        close();
                      }}
                    />
                  ))
                }
              </StMenuButton>
            </div>
          ) : null}
          <StSlider label="Strength" value={d.denoise ?? 0.4} onChange={(v) => p.onDetailer({ ...d, denoise: v })} min={0.05} max={1} step={0.05} format={(v) => v.toFixed(2)} resetTo={0.4} tip="How much each face is redrawn" disabled={p.disabled} />
          <div className="grid grid-cols-2 gap-3">
            <StSlider small label="Steps" value={d.steps ?? 12} onChange={(v) => p.onDetailer({ ...d, steps: v })} min={1} max={50} step={1} resetTo={12} tip="Steps per face" disabled={p.disabled} />
            <StSlider small label="Face size" value={d.guide_size ?? 512} onChange={(v) => p.onDetailer({ ...d, guide_size: v })} min={256} max={1024} step={64} format={(v) => `${v}px`} resetTo={512} tip="Resolution each face is redrawn at" disabled={p.disabled} />
          </div>
        </div>
      ) : null}
    </StCard>
  );
}
