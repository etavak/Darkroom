import { useState, type ReactNode } from 'react';
import { CheckSquare, ChevronDown, ImageIcon, PersonStanding, Plus, TriangleAlert, Upload, X } from 'lucide-react';
import { DEFAULT_CONTROLNET_UI, type ControlNetUiState } from '@/components/controls/ControlNetPanel';
import { padsForAspect } from '@/lib/sourceImage';
import { shortModelName } from '@/lib/modelProfiles';
import type { OutpaintSettings, SourceFitMode, SourceImageState, SourceSizeMode, WorkMode } from '@/types/generation';
import { StCard, StCardBtn, StMenuButton, StMenuItem, StSeg, StSlider } from './primitives';

/** Card-header upload button (a label around a hidden file input). */
function UploadBtn({ tip, disabled, onFile }: { tip: string; disabled?: boolean; onFile: (f: File) => void }) {
  return (
    <label
      className="st-card-btn"
      aria-label={tip}
      data-tip={tip}
      aria-disabled={disabled}
      style={disabled ? { opacity: 0.4, cursor: 'default' } : undefined}
    >
      <Upload />
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function CardHeader({ icon, title, sub, children }: { icon: ReactNode; title: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3 pl-4 pr-3">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="truncate text-[13px]" style={{ color: 'var(--s-muted)' }}>
          {sub}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

const EXTEND_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:2'];

type ImageToImageProps = {
  source: SourceImageState | null;
  mode: WorkMode;
  supportsEdit: boolean;
  denoise: number;
  onDenoise: (v: number) => void;
  sizeMode: SourceSizeMode;
  onSizeMode: (v: SourceSizeMode) => void;
  fit: SourceFitMode;
  onFit: (v: SourceFitMode) => void;
  outpaint: OutpaintSettings;
  onOutpaint: (v: OutpaintSettings) => void;
  /** Current Image settings size */
  outputW: number;
  outputH: number;
  disabled?: boolean;
  canUseSelected: boolean;
  onUseSelected: () => void;
  onUpload: (f: File) => void;
  onClear: () => void;
  onMode: (m: WorkMode) => void;
};

/** Base image for restyle / extend / edit, with the strength and size controls once one is set. */
export function ImageToImageCard(p: ImageToImageProps) {
  const src = p.source;
  const modes: Array<{ value: WorkMode; label: string; tip: string }> = [
    { value: 'img2img', label: 'Restyle', tip: 'Redraw the picture following the prompt' },
    { value: 'outpaint', label: 'Extend', tip: 'Grow the canvas and fill the new space' },
    ...(p.supportsEdit
      ? [{ value: 'edit' as WorkMode, label: 'Edit', tip: 'Change it with an instruction — e.g. “make it night”' }]
      : []),
  ];
  const patchOut = (patch: Partial<OutpaintSettings>) => p.onOutpaint({ ...p.outpaint, ...patch });

  return (
    <StCard>
      <CardHeader
        icon={
          src ? (
            <span className="st-thumb h-11 w-11" data-tip={`${src.width}×${src.height}`} tabIndex={0}>
              <img src={src.previewUrl} alt="Base image" />
            </span>
          ) : (
            <span className="st-card-icon">
              <ImageIcon />
            </span>
          )
        }
        title="Image to image"
        sub={src ? `${src.width && src.height ? `${src.width}×${src.height} · ` : ''}${src.localName}` : 'Restyle, extend or edit a picture'}
      >
        <UploadBtn tip={src ? 'Replace with an uploaded image' : 'Upload a base image'} disabled={p.disabled} onFile={p.onUpload} />
        {src ? (
          <StCardBtn label="Remove the base image" onClick={p.onClear} disabled={p.disabled}>
            <X />
          </StCardBtn>
        ) : (
          <StCardBtn
            label="Use selected image"
            tip={p.canUseSelected ? 'Use the selected image as the base' : 'Select an image in History first'}
            onClick={p.onUseSelected}
            disabled={p.disabled || !p.canUseSelected}
          >
            <CheckSquare />
          </StCardBtn>
        )}
      </CardHeader>

      {src ? (
        <div className="flex flex-col gap-3 px-4 pb-3.5">
          {modes.length > 1 ? <StSeg small value={p.mode} onChange={p.onMode} options={modes} disabled={p.disabled} /> : null}

          {p.mode === 'img2img' || p.mode === 'generate' ? (
            <>
              <StSlider
                label="Strength"
                value={p.denoise}
                onChange={p.onDenoise}
                min={0.05}
                max={1}
                step={0.05}
                format={(v) => v.toFixed(2)}
                ends={['Keep closer', 'Change more']}
                resetTo={0.55}
                tip="How much to change — low keeps the original, high reimagines it"
                disabled={p.disabled}
              />
              <div className="st-row">
                <span className="text-[13px]">Output size</span>
                <div className="w-[196px]">
                  <StSeg
                    small
                    value={p.sizeMode}
                    onChange={p.onSizeMode}
                    disabled={p.disabled}
                    options={[
                      { value: 'match', label: 'Match image', tip: `Keep the base image’s size (${src.width}×${src.height})` },
                      { value: 'aspect', label: `${p.outputW}×${p.outputH}`, tip: 'Use the Image settings size' },
                    ]}
                  />
                </div>
              </div>
              {p.sizeMode === 'aspect' ? (
                <div className="st-row">
                  <span className="text-[13px]">Fit</span>
                  <div className="w-[196px]">
                    <StSeg
                      small
                      value={p.fit}
                      onChange={p.onFit}
                      disabled={p.disabled}
                      options={[
                        { value: 'crop', label: 'Crop', tip: 'Fill the frame — the edges of the base may be cut off' },
                        { value: 'fit', label: 'Fit', tip: 'Fit the whole base inside the frame' },
                      ]}
                    />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {p.mode === 'outpaint' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="st-lbl text-[13px]">Extend to</span>
                <StSeg
                  small
                  value={p.outpaint.targetAspect ?? ''}
                  disabled={p.disabled}
                  onChange={(v) => {
                    const pads = padsForAspect(src.width, src.height, v);
                    if (pads) patchOut({ ...pads, targetAspect: v });
                  }}
                  options={EXTEND_ASPECTS.map((a) => ({ value: a, label: a, tip: `Grow the canvas to ${a}` }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
                  <StSlider
                    key={side}
                    small
                    label={side[0]!.toUpperCase() + side.slice(1)}
                    value={p.outpaint[side]}
                    onChange={(n) => patchOut({ [side]: n, targetAspect: null })}
                    min={0}
                    max={1024}
                    step={8}
                    format={(v) => `${v}px`}
                    resetTo={0}
                    tip={`Pixels to add on the ${side}`}
                    disabled={p.disabled}
                  />
                ))}
              </div>
              <StSlider
                label="Blend edge"
                value={p.outpaint.feather}
                onChange={(n) => patchOut({ feather: n })}
                min={0}
                max={256}
                step={4}
                format={(v) => `${v}px`}
                resetTo={40}
                tip="How softly the new area blends into the original"
                disabled={p.disabled}
              />
              <StSlider
                label="Strength"
                value={p.denoise}
                onChange={p.onDenoise}
                min={0.05}
                max={1}
                step={0.05}
                format={(v) => v.toFixed(2)}
                resetTo={0.7}
                tip="How freely the new area is painted"
                disabled={p.disabled}
              />
            </>
          ) : null}

          {p.mode === 'edit' ? (
            <p className="m-0 text-[12.5px] leading-normal" style={{ color: 'var(--s-muted)' }}>
              Describe the change in the prompt — “make it night”, “add a red scarf”. The rest of the picture stays as it is.
            </p>
          ) : null}
        </div>
      ) : null}
    </StCard>
  );
}

type GuideType = ControlNetUiState['preprocessor'];

const CN_TYPES: Array<{ id: GuideType; name: string; desc: string; keys: string[]; aux: boolean }> = [
  { id: 'openpose', name: 'Pose', desc: 'Copies the body pose found in the guide', keys: ['openpose', 'pose'], aux: true },
  { id: 'depth', name: 'Depth', desc: 'Keeps the layout and distances of the guide', keys: ['depth'], aux: true },
  { id: 'canny', name: 'Edges', desc: 'Follows the outlines of the guide', keys: ['canny', 'lineart', 'edge', 'scribble'], aux: true },
  { id: 'none', name: 'Ready-made map', desc: 'The guide already is a pose, depth or edge map — used as-is', keys: [], aux: false },
];

/** Best installed model for a guide type (by filename), else a union model, else the first. */
function pickModel(models: string[], type: GuideType, current: string): string {
  const lower = (m: string) => m.toLowerCase();
  const keys = CN_TYPES.find((t) => t.id === type)?.keys ?? [];
  if (current && (keys.length === 0 || keys.some((k) => lower(current).includes(k)) || lower(current).includes('union'))) {
    return current;
  }
  return (
    models.find((m) => keys.some((k) => lower(m).includes(k))) ??
    models.find((m) => lower(m).includes('union')) ??
    (current || models[0] || '')
  );
}

type ControlNetProps = {
  value: ControlNetUiState;
  onChange: (v: ControlNetUiState) => void;
  models: string[];
  available: boolean;
  auxAvailable: boolean;
  disabled?: boolean;
  canUseSelected: boolean;
  onUseSelected: () => Promise<{ comfyName: string; previewUrl: string } | null>;
  onUpload: (f: File) => Promise<{ comfyName: string; previewUrl: string }>;
  onAddModel: () => void;
};

/** One ControlNet guide: type, model, guide image, strength and the step range it applies to. */
export function ControlNetCard(p: ControlNetProps) {
  const v = p.value;
  const [busy, setBusy] = useState(false);
  const patch = (partial: Partial<ControlNetUiState>) => p.onChange({ ...v, ...partial });
  const type = CN_TYPES.find((t) => t.id === v.preprocessor) ?? CN_TYPES[3];

  const add = () => {
    const pre: GuideType = p.auxAvailable ? 'openpose' : 'none';
    p.onChange({ ...DEFAULT_CONTROLNET_UI, enabled: true, preprocessor: pre, end_percent: 0.8, name: pickModel(p.models, pre, '') });
  };
  const setImage = async (get: () => Promise<{ comfyName: string; previewUrl: string } | null>) => {
    setBusy(true);
    try {
      const res = await get();
      if (res) p.onChange({ ...v, image: res.comfyName, previewUrl: res.previewUrl });
    } finally {
      setBusy(false);
    }
  };

  const sub = !p.available
    ? 'Not available in this ComfyUI'
    : v.enabled
      ? `${type.name} guide · ${v.strength.toFixed(2)}`
      : 'Guide pose, depth or edges';

  return (
    <StCard>
      <CardHeader
        icon={
          <span className="st-card-icon">
            <PersonStanding />
          </span>
        }
        title="ControlNet"
        sub={sub}
      >
        <StCardBtn
          label="Add a guide"
          tip={!p.available ? 'ComfyUI has no ControlNet loader — update ComfyUI' : v.enabled ? 'One guide at a time' : 'Add a guide image (pose, depth, edges…)'}
          onClick={add}
          disabled={p.disabled || !p.available || v.enabled}
        >
          <Plus />
        </StCardBtn>
      </CardHeader>

      {v.enabled && p.available ? (
        <div className="st-card-sec">
          <div className="flex gap-3">
            {v.previewUrl ? (
              <span className="st-thumb h-20 w-16" data-tip="Guide image" tabIndex={0}>
                <img src={v.previewUrl} alt="Guide" />
              </span>
            ) : (
              <span className="st-thumb empty h-20 w-16">{busy ? '…' : 'No image'}</span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <StMenuButton
                  className="min-w-0 flex-1"
                  tip={type.desc}
                  label={`Guide type: ${type.name}`}
                  disabled={p.disabled}
                  menuStyle={{ left: 0, width: 250 }}
                  button={
                    <span className="st-chip h-[34px] w-full font-semibold" style={{ background: 'var(--s-raised)' }}>
                      <span className="truncate">{type.name}</span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    </span>
                  }
                >
                  {(close) =>
                    CN_TYPES.map((t) => {
                      const locked = t.aux && !p.auxAvailable;
                      return (
                        <StMenuItem
                          key={t.id}
                          title={t.name}
                          detail={locked ? 'Needs ControlNet Aux — install it from Components → Custom nodes' : t.desc}
                          selected={t.id === v.preprocessor}
                          onClick={() => {
                            if (locked) return;
                            patch({ preprocessor: t.id, name: pickModel(p.models, t.id, v.name) });
                            close();
                          }}
                        />
                      );
                    })
                  }
                </StMenuButton>
                <button type="button" className="st-ibtn h-8 w-8" onClick={() => p.onChange({ ...DEFAULT_CONTROLNET_UI })} disabled={p.disabled} aria-label="Remove guide" data-tip="Remove this guide">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {p.models.length > 0 ? (
                <StMenuButton
                  tip="ControlNet model"
                  label="ControlNet model"
                  disabled={p.disabled}
                  menuStyle={{ left: 0, width: 280 }}
                  button={
                    <span className="st-mono inline-flex max-w-full items-center gap-1 text-[11px]" style={{ color: v.name ? 'var(--s-faint)' : '#e2b44f' }}>
                      <span className="truncate">{v.name ? shortModelName(v.name) : 'Choose a model'}</span>
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    </span>
                  }
                >
                  {(close) => (
                    <>
                      {p.models.map((m) => (
                        <StMenuItem
                          key={m}
                          title={shortModelName(m)}
                          selected={m === v.name}
                          onClick={() => {
                            patch({ name: m });
                            close();
                          }}
                        />
                      ))}
                      <StMenuItem
                        title={<span style={{ color: 'var(--s-accent)' }}>Add a ControlNet model…</span>}
                        onClick={() => {
                          close();
                          p.onAddModel();
                        }}
                      />
                    </>
                  )}
                </StMenuButton>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="st-pill h-[26px] text-xs"
                  disabled={p.disabled || busy || !p.canUseSelected}
                  onClick={() => void setImage(p.onUseSelected)}
                  data-tip={p.canUseSelected ? 'Use the selected image as the guide' : 'Select an image in History first'}
                >
                  Use selected
                </button>
                <label className="st-pill h-[26px] text-xs" data-tip="Upload a guide image" style={p.disabled || busy ? { opacity: 0.5 } : { cursor: 'pointer' }}>
                  Upload
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={p.disabled || busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void setImage(() => p.onUpload(f));
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
          <StSlider
            label="Strength"
            value={v.strength}
            onChange={(n) => patch({ strength: n })}
            min={0}
            max={2}
            step={0.05}
            format={(n) => n.toFixed(2)}
            resetTo={1}
            tip="How strongly the guide steers the image"
            disabled={p.disabled}
          />
          <div className="grid grid-cols-2 gap-3">
            <StSlider
              small
              label="Start"
              value={Math.round(v.start_percent * 100)}
              onChange={(n) => patch({ start_percent: Math.min(n, Math.round(v.end_percent * 100) - 5) / 100 })}
              min={0}
              max={100}
              step={5}
              format={(n) => `${n}%`}
              resetTo={0}
              tip="When in the steps the guide starts applying"
              disabled={p.disabled}
            />
            <StSlider
              small
              label="End"
              value={Math.round(v.end_percent * 100)}
              onChange={(n) => patch({ end_percent: Math.max(n, Math.round(v.start_percent * 100) + 5) / 100 })}
              min={0}
              max={100}
              step={5}
              format={(n) => `${n}%`}
              resetTo={100}
              tip="When it stops — ending early leaves the last steps free for detail"
              disabled={p.disabled}
            />
          </div>
          {p.models.length === 0 ? (
            <div className="st-warn">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" style={{ color: '#e2b44f' }} />
              <span className="flex-1">No ControlNet models installed yet.</span>
              <button type="button" className="st-pill h-[26px] text-xs" onClick={p.onAddModel} data-tip="Add a ControlNet model">
                Add
              </button>
            </div>
          ) : !v.image ? (
            <p className="m-0 text-[12px]" style={{ color: 'var(--s-muted)' }}>
              Add a guide image — the guide is skipped until it has one.
            </p>
          ) : null}
        </div>
      ) : null}
    </StCard>
  );
}
