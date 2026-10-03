import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Check, ChevronDown, GripVertical, Plus, X } from 'lucide-react';
import { shortModelName } from '@/lib/modelProfiles';
import type { DetailerSettings, HiresFixSettings, LoraSettings } from '@/types/generation';
import { StCard, StCardBtn, StMenuButton, StMenuItem, StSlider, StSwitch } from './primitives';

const MAX_LORAS = 8;

/** File name without folder or extension */
const loraLabel = (name: string) => shortModelName(name.replace(/\.(safetensors|ckpt|pt|bin|gguf)$/i, ''));

/** Folder part of a model path ("" at the top level) */
function folderOf(name: string): string {
  const i = name.replace(/\\/g, '/').lastIndexOf('/');
  return i > 0 ? name.slice(0, i) : '';
}

type LoraCardProps = {
  loras: LoraSettings[];
  onChange: (l: LoraSettings[]) => void;
  pickerOpen: boolean;
  onPickerOpen: (open: boolean) => void;
  disabled?: boolean;
};

/** Stacked LoRAs: on/off, weight, remove, drag the grip (or ↑↓ on it) to reorder. */
export function LoraCard({ loras, onChange, pickerOpen, onPickerOpen, disabled }: LoraCardProps) {
  const listRef = useRef<HTMLDivElement>(null);
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
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-sm font-semibold" data-tip={l.name}>
                    {loraLabel(l.name)}
                  </span>
                  {folderOf(l.name) ? (
                    <span className="truncate text-xs" style={{ color: 'var(--s-muted)' }}>
                      {folderOf(l.name)}
                    </span>
                  ) : null}
                </div>
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
            </div>
          );
        })}
      </div>
    </StCard>
  );
}

type LoraPickerProps = {
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
export function LoraPicker({ options, loras, onAdd, onAddModel, onClose, loading, inline }: LoraPickerProps) {
  const [q, setQ] = useState('');
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const added = new Set(loras.map((l) => l.name));
  const full = loras.length >= MAX_LORAS;
  const hits = options.filter((o) => !q.trim() || o.toLowerCase().includes(q.trim().toLowerCase()));

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
      <div className="flex flex-col gap-1.5">
        {loading ? (
          <p className="m-0 px-0.5 text-[13px]" style={{ color: 'var(--s-muted)' }}>Loading…</p>
        ) : options.length === 0 ? (
          <p className="m-0 px-0.5 text-[13px]" style={{ color: 'var(--s-muted)' }}>No LoRAs installed yet.</p>
        ) : hits.length === 0 ? (
          <p className="m-0 px-0.5 text-[13px]" style={{ color: 'var(--s-muted)' }}>No LoRAs match.</p>
        ) : (
          hits.map((name) => {
            const isAdded = added.has(name);
            return (
              <button
                key={name}
                type="button"
                className="st-listbtn flex-row items-center gap-3"
                disabled={isAdded || full}
                style={{ opacity: isAdded ? 0.55 : 1 }}
                onClick={() => onAdd(name)}
                data-tip={isAdded ? 'Already added' : full ? `Up to ${MAX_LORAS} LoRAs` : name}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold">{loraLabel(name)}</span>
                  {folderOf(name) ? (
                    <span className="truncate text-xs" style={{ color: 'var(--s-muted)' }}>
                      {folderOf(name)}
                    </span>
                  ) : null}
                </span>
                {isAdded ? (
                  <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--s-muted)' }}>
                    <Check className="h-3.5 w-3.5" /> Added
                  </span>
                ) : null}
              </button>
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
  disabled?: boolean;
};

/** Hires fix and Face detailer: a switch each, their settings underneath while on. */
export function ExtrasCard(p: ExtrasProps) {
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
            {p.hiresApplies ? `Second pass at ${h.scale}× for detail` : 'Only for new images, not image to image'}
          </div>
        </div>
        <StSwitch on={h.enabled} onChange={(v) => p.onHires({ ...h, enabled: v })} label="Hires fix" tip="Adds a second, higher-resolution pass" disabled={p.disabled} />
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
            {p.detailerAvailable ? 'Redraws faces at higher resolution' : 'Needs Impact Pack — Components → Custom nodes'}
          </div>
        </div>
        <StSwitch
          on={dOn}
          onChange={(v) => p.onDetailer({ ...d, enabled: v })}
          label="Face detailer"
          tip={p.detailerAvailable ? 'Finds faces and redraws them sharper' : 'Install Impact Pack to use the face detailer'}
          disabled={p.disabled || !p.detailerAvailable}
        />
      </div>
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
