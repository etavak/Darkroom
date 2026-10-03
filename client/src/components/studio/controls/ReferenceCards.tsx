import { useEffect, useState, type ReactNode } from 'react';
import { CheckSquare, ChevronDown, ImageIcon, PersonStanding, Plus, TriangleAlert, Upload, X } from 'lucide-react';
import { controlNetMapApi, fetchControlNetJob, fetchControlNetOptions, installControlNetApi, type ControlNetInstallJob, type ControlNetOption } from '@/lib/api';
import { DEFAULT_CONTROLNET_UI, MAX_CONTROLNETS, type ControlNetUiState } from '@/lib/generationDefaults';
import { shortModelName } from '@/lib/modelProfiles';
import type { SourceFitMode, SourceImageState, SourceSizeMode, WorkMode } from '@/types/generation';
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

function InpaintGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 3l3 3-9 9-4 1 1-4z" />
      <path d="M7 17c-2 0-3 1.5-3 4 2.5 0 4-1 4-3" />
    </svg>
  );
}

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
  /** Current Image settings size */
  outputW: number;
  outputH: number;
  disabled?: boolean;
  canUseSelected: boolean;
  onUseSelected: () => void;
  onUpload: (f: File) => void;
  onClear: () => void;
  onMode: (m: WorkMode) => void;
  /** Open the inpaint & extend editor on the base image */
  onOpenEditor: () => void;
};

/** Base image for restyle / extend / edit, with the strength and size controls once one is set. */
export function ImageToImageCard(p: ImageToImageProps) {
  const src = p.source;
  const modes: Array<{ value: WorkMode; label: string; tip: string }> = [
    { value: 'img2img', label: 'Restyle', tip: 'Redraw the picture following the prompt' },
    ...(p.supportsEdit
      ? [{ value: 'edit' as WorkMode, label: 'Edit', tip: 'Change it with an instruction — e.g. “make it night”' }]
      : []),
  ];

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

          <button type="button" className="st-pill self-start" onClick={p.onOpenEditor} disabled={p.disabled} data-tip="Paint what to redraw, or drag the edges out to extend  ·  opens the editor">
            <InpaintGlyph /> Inpaint or extend…
          </button>

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
  { id: 'canny', name: 'Edges', desc: 'Follows the outlines of the guide', keys: ['canny', 'edge', 'scribble'], aux: true },
  { id: 'lineart', name: 'Line art', desc: 'Follows clean lines — good for sketches and anime art', keys: ['lineart', 'line_art', 'anime'], aux: true },
  { id: 'tile', name: 'Tile', desc: 'Keeps the colours and composition and adds detail — good for upscales', keys: ['tile'], aux: false },
  { id: 'none', name: 'Ready-made map', desc: 'The guide already is a pose, depth or edge map — used as-is', keys: [], aux: false },
];
const typeOf = (id: GuideType) => CN_TYPES.find((t) => t.id === id) ?? CN_TYPES[CN_TYPES.length - 1];

/**
 * Best installed model for a guide type (by filename), else a union model, else the first.
 * `preferred` (models known to fit the current model) are tried before the rest.
 */
function pickModel(models: string[], type: GuideType, current: string, preferred: string[] = []): string {
  const lower = (m: string) => m.toLowerCase();
  const keys = typeOf(type).keys;
  const fits = (m: string) => keys.length === 0 || keys.some((k) => lower(m).includes(k)) || lower(m).includes('union');
  if (current && fits(current) && (!preferred.length || preferred.includes(current))) return current;
  for (const pool of preferred.length ? [preferred, models] : [models]) {
    const hit = pool.find((m) => keys.some((k) => lower(m).includes(k))) ?? pool.find((m) => lower(m).includes('union'));
    if (hit) return hit;
  }
  return current || preferred[0] || models[0] || '';
}

const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
const stemOf = (n: string) => n.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').toLowerCase().replace(/^dep-/, '');

type GuideImage = { comfyName: string; previewUrl: string };

type ControlNetProps = {
  value: ControlNetUiState[];
  onChange: (v: ControlNetUiState[]) => void;
  models: string[];
  available: boolean;
  auxAvailable: boolean;
  /** Aux is in custom_nodes but ComfyUI hasn't loaded it (needs a restart, or failed to import) */
  auxNeedsRestart?: boolean;
  disabled?: boolean;
  canUseSelected: boolean;
  onUseSelected: () => Promise<GuideImage | null>;
  onUpload: (f: File) => Promise<GuideImage>;
  onAddModel: () => void;
  /** The current model's family, for the recommended download */
  familyId: string | null;
  familyName: string | null;
  /** A ControlNet model finished downloading (reload the model list) */
  onModelsChanged: () => void;
};

/** ControlNet guides (up to 3, applied in order): type, model, guide image, strength and step range. */
export function ControlNetCard(p: ControlNetProps) {
  const guides = p.value;
  const full = guides.length >= MAX_CONTROLNETS;
  const [opts, setOpts] = useState<ControlNetOption[] | null>(null);
  const [job, setJob] = useState<ControlNetInstallJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const { familyId, onModelsChanged } = p;
  const modelCount = p.models.length;

  // Which curated downloads fit this model (re-read when the installed list changes)
  useEffect(() => {
    let live = true;
    fetchControlNetOptions(familyId)
      .then((r) => live && setOpts(r.items))
      .catch(() => live && setOpts(null));
    return () => {
      live = false;
    };
  }, [familyId, modelCount]);

  // Follow a download until it finishes
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const t = window.setInterval(() => {
      fetchControlNetJob(job.id)
        .then((j) => {
          setJob(j);
          if (j.status === 'done') onModelsChanged();
          if (j.status === 'error') setJobError(j.error ?? 'Download failed');
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(t);
  }, [job, onModelsChanged]);

  // Installed models known to fit the current model, tried first when picking
  const fitStems = new Set((opts ?? []).map((o) => stemOf(o.filename)));
  const preferred = familyId ? p.models.filter((m) => fitStems.has(stemOf(m))) : [];
  const suggestions = opts && familyId && !preferred.length ? opts.filter((o) => o.recommended && !o.installed) : [];
  // Guides added before any model was installed get one as soon as a fitting model appears
  const preferredKey = preferred.join('|');
  const { onChange } = p;
  useEffect(() => {
    if (!guides.some((g) => !g.name) || !modelCount) return;
    const next = guides.map((g) => (g.name ? g : { ...g, name: pickModel(p.models, g.preprocessor, '', preferred) }));
    if (next.some((g, i) => g.name !== guides[i].name)) onChange(next);
    // Runs when the installed models change (not on every guide edit)
  }, [preferredKey, modelCount]);

  const install = (o: ControlNetOption) => {
    setJobError(null);
    installControlNetApi(o.id)
      .then(setJob)
      .catch((e: unknown) => setJobError(e instanceof Error ? e.message : 'Download failed'));
  };

  const add = () => {
    // A second guide defaults to a different type than the ones already there
    const used = new Set(guides.map((g) => g.preprocessor));
    const order: GuideType[] = p.auxAvailable ? ['openpose', 'depth', 'lineart', 'canny', 'tile'] : ['none', 'tile'];
    const pre = order.find((t) => !used.has(t)) ?? order[0];
    p.onChange([...guides, { ...DEFAULT_CONTROLNET_UI, enabled: true, preprocessor: pre, end_percent: 0.8, name: pickModel(p.models, pre, '', preferred) }]);
  };

  const sub = !p.available
    ? 'Not available in this ComfyUI'
    : guides.length
      ? guides.map((g) => `${g.preprocessor === 'none' ? 'Map' : typeOf(g.preprocessor).name} ${g.strength.toFixed(2)}`).join(' + ')
      : 'Guide pose, depth, edges or line art';

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
          tip={
            !p.available
              ? 'ComfyUI has no ControlNet loader — update ComfyUI'
              : full
                ? `Up to ${MAX_CONTROLNETS} guides`
                : guides.length
                  ? 'Add another guide — they apply in order'
                  : 'Add a guide image (pose, depth, edges…)'
          }
          onClick={add}
          disabled={p.disabled || !p.available || full}
        >
          <Plus />
        </StCardBtn>
      </CardHeader>

      {p.available
        ? guides.map((g, i) => (
            <GuideSection
              key={i}
              index={i}
              count={guides.length}
              v={g}
              props={p}
              preferred={preferred}
              noModelNote={!suggestions.length}
              onChange={(next) => p.onChange(guides.map((x, j) => (j === i ? next : x)))}
              onRemove={() => p.onChange(guides.filter((_, j) => j !== i))}
            />
          ))
        : null}

      {p.available && guides.length > 0 && p.auxNeedsRestart ? (
        <div className="st-card-sec">
          <div className="st-warn" role="note">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" style={{ color: '#e2b44f' }} />
            <span className="flex-1">
              ControlNet Aux is installed, but ComfyUI hasn’t loaded it. Restart ComfyUI to use Pose, Depth, Edges and Line art on photos.
            </span>
          </div>
        </div>
      ) : null}

      {p.available && guides.length > 0 && (suggestions.length > 0 || job) ? (
        <div className="st-card-sec" role="region" aria-label="Recommended ControlNet model">
          {job && job.status !== 'error' ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px]">
                {job.status === 'done' ? `${job.title} installed — guides use it automatically.` : `Downloading ${job.title}… ${Math.floor(job.progress)}%`}
              </span>
              {job.status === 'running' ? (
                <span className="h-1 overflow-hidden rounded-full" style={{ background: 'var(--s-raised2)' }}>
                  <span className="block h-full" style={{ width: `${job.progress}%`, background: 'var(--s-accent)', transition: 'width .4s' }} />
                </span>
              ) : null}
            </div>
          ) : (
            <>
              <span className="text-[12.5px]" style={{ color: 'var(--s-muted)' }}>
                {p.models.length
                  ? `None of your ControlNet models fit ${p.familyName ?? 'this model'}.`
                  : `No ControlNet model for ${p.familyName ?? 'this model'} yet.`}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`st-pill h-[28px] text-xs ${suggestions.length === 1 ? 'st-pill-accent' : ''}`}
                    disabled={p.disabled}
                    onClick={() => install(o)}
                    data-tip={`${o.notes ?? o.filename}${o.nonCommercial ? '\nNon-commercial licence' : ''}\nDownloads ${gb(o.sizeBytes)} into ComfyUI/models/controlnet`}
                  >
                    Install {o.title} · {gb(o.sizeBytes)}
                  </button>
                ))}
                <button type="button" className="st-pill h-[28px] text-xs" onClick={p.onAddModel} data-tip="Download or import another ControlNet file">
                  Other…
                </button>
              </div>
              {suggestions.some((o) => o.nonCommercial) ? (
                <span className="text-[11.5px]" style={{ color: 'var(--s-faint)' }}>FLUX.1-dev non-commercial licence.</span>
              ) : null}
            </>
          )}
          {jobError ? (
            <div className="st-warn" role="alert">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" style={{ color: '#e2b44f' }} />
              <span className="flex-1">{jobError}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </StCard>
  );
}

function GuideSection({
  index,
  count,
  v,
  props: p,
  preferred,
  noModelNote,
  onChange,
  onRemove,
}: {
  index: number;
  count: number;
  v: ControlNetUiState;
  props: ControlNetProps;
  preferred: string[];
  /** Show "No ControlNet models installed" (off when the card offers a download instead) */
  noModelNote: boolean;
  onChange: (v: ControlNetUiState) => void;
  onRemove: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [map, setMap] = useState<{ key: string; url: string | null; busy: boolean; error: string | null } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const patch = (partial: Partial<ControlNetUiState>) => onChange({ ...v, ...partial });
  const type = typeOf(v.preprocessor);
  const mapKey = `${v.preprocessor}|${v.image}`;
  const canMap = Boolean(v.image) && v.preprocessor !== 'none' && (p.auxAvailable || !type.aux) && !(v.preprocessor === 'tile' && !p.auxAvailable);
  const current = map && map.key === mapKey ? map : null;

  // A new image or type makes the old map stale
  useEffect(() => {
    setShowMap(false);
  }, [mapKey]);
  useEffect(() => {
    const url = map?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [map?.url]);

  const setImage = async (get: () => Promise<GuideImage | null>) => {
    setBusy(true);
    try {
      const res = await get();
      if (res) onChange({ ...v, image: res.comfyName, previewUrl: res.previewUrl });
    } finally {
      setBusy(false);
    }
  };
  const toggleMap = () => {
    if (showMap) {
      setShowMap(false);
      return;
    }
    setShowMap(true);
    if (current?.url || current?.busy) return;
    const key = mapKey;
    setMap({ key, url: null, busy: true, error: null });
    controlNetMapApi(v.image, v.preprocessor)
      .then((url) => setMap((m) => (m && m.key === key ? { key, url, busy: false, error: null } : (URL.revokeObjectURL(url), m))))
      .catch((e: unknown) => setMap((m) => (m && m.key === key ? { key, url: null, busy: false, error: e instanceof Error ? e.message : 'Could not make the map' } : m)));
  };

  const thumbSrc = showMap && current?.url ? current.url : v.previewUrl;

  return (
    <div className="st-card-sec">
      {count > 1 ? (
        <div className="st-sec -mb-1" style={{ fontSize: 11 }}>
          Guide {index + 1}
        </div>
      ) : null}
      <div className="flex gap-3">
        <div className="flex shrink-0 flex-col items-center gap-1">
          {thumbSrc ? (
            <span className="st-thumb h-20 w-16" data-tip={showMap ? `${type.name} map — what ControlNet follows` : 'Guide image'} tabIndex={0}>
              <img src={thumbSrc} alt={showMap ? `${type.name} map` : 'Guide'} />
            </span>
          ) : (
            <span className="st-thumb empty h-20 w-16">{busy ? '…' : 'No image'}</span>
          )}
          {canMap ? (
            <button
              type="button"
              className="border-0 bg-transparent p-0 text-[11px]"
              style={{ color: showMap ? 'var(--s-accent)' : 'var(--s-muted)', cursor: 'pointer' }}
              disabled={p.disabled}
              aria-pressed={showMap}
              onClick={toggleMap}
              data-tip={showMap ? 'Show the guide image' : `Show the ${type.name.toLowerCase()} map ControlNet will follow (runs in ComfyUI)`}
            >
              {showMap && current?.busy ? 'Making…' : showMap ? 'Show image' : 'Show map'}
            </button>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <StMenuButton
              className="min-w-0 flex-1"
              tip={type.desc}
              label={`Guide type: ${type.name}`}
              disabled={p.disabled}
              menuStyle={{ left: 0, width: 260 }}
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
                      detail={
                        locked
                          ? p.auxNeedsRestart
                            ? 'ControlNet Aux is installed — restart ComfyUI to load it'
                            : 'Needs ControlNet Aux — launcher → ControlNet models (or Custom nodes)'
                          : t.desc
                      }
                      selected={t.id === v.preprocessor}
                      onClick={() => {
                        if (locked) return;
                        patch({ preprocessor: t.id, name: pickModel(p.models, t.id, v.name, preferred) });
                        close();
                      }}
                    />
                  );
                })
              }
            </StMenuButton>
            <button type="button" className="st-ibtn h-8 w-8" onClick={onRemove} disabled={p.disabled} aria-label="Remove guide" data-tip="Remove this guide">
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
      {showMap && current?.error ? (
        <div className="st-warn" role="alert">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" style={{ color: '#e2b44f' }} />
          <span className="flex-1">{current.error}</span>
        </div>
      ) : null}
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
      {p.models.length === 0 && index === 0 && noModelNote ? (
        <div className="st-warn">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" style={{ color: '#e2b44f' }} />
          <span className="flex-1">No ControlNet models installed yet.</span>
          <button type="button" className="st-pill h-[26px] text-xs" onClick={p.onAddModel} data-tip="Add a ControlNet model">
            Add
          </button>
        </div>
      ) : p.models.length > 0 && !v.image ? (
        <p className="m-0 text-[12px]" style={{ color: 'var(--s-muted)' }}>
          Add a guide image — the guide is skipped until it has one.
        </p>
      ) : null}
    </div>
  );
}

type InpaintProps = {
  source: SourceImageState;
  /** "Inpaint", "Extend" or "Inpaint & extend" — whatever the mask does */
  title: string;
  summary: string;
  /** Extended beyond the original size */
  extended: boolean;
  denoise: number;
  onDenoise: (v: number) => void;
  feather: number;
  onFeather: (v: number) => void;
  disabled?: boolean;
  onEdit: () => void;
  onStop: () => void;
};

/** Shown while a mask / extension is set: what will be redrawn, how strongly, and the way back. */
export function InpaintCard(p: InpaintProps) {
  return (
    <StCard style={{ borderColor: 'var(--s-accent)' }}>
      <CardHeader
        icon={
          <span className="st-thumb h-11 w-11">
            <img src={p.source.previewUrl} alt="Image being inpainted" />
          </span>
        }
        title={p.title}
        sub={p.summary}
      >
        <StCardBtn label="Edit mask" tip="Edit the mask and edges in the editor" onClick={p.onEdit} disabled={p.disabled}>
          <InpaintGlyph />
        </StCardBtn>
        <StCardBtn label="Remove reference" tip="Remove this reference — back to normal generation" onClick={p.onStop} disabled={p.disabled}>
          <X />
        </StCardBtn>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-3.5">
        <StSlider
          label="Strength"
          value={p.denoise}
          onChange={p.onDenoise}
          min={0.05}
          max={1}
          step={0.05}
          format={(v) => v.toFixed(2)}
          ends={['Stay close', 'Redraw freely']}
          resetTo={p.extended ? 1 : 0.8}
          tip={p.extended ? 'How freely the masked and new areas are painted — extending works best near 1' : 'How freely the masked area is redrawn'}
          disabled={p.disabled}
        />
        {p.extended ? (
          <StSlider
            label="Blend edge"
            value={p.feather}
            onChange={p.onFeather}
            min={0}
            max={256}
            step={4}
            format={(v) => `${v}px`}
            resetTo={40}
            tip="How softly the new area blends into the original"
            disabled={p.disabled}
          />
        ) : null}
      </div>
    </StCard>
  );
}
