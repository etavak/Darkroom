import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ModelSelect } from '@/components/controls/ModelSelect';
import { cn } from '@/lib/utils';
import type { MissingSlot } from '@/lib/modelReadiness';
import type { ModelCatalog, ModelLoadMode } from '@/types/generation';

type Props = {
  catalog: ModelCatalog;
  mode: ModelLoadMode;
  onModeChange: (mode: ModelLoadMode) => void;
  checkpoint: string;
  onCheckpointChange: (v: string) => void;
  unet: string;
  onUnetChange: (v: string) => void;
  clipName: string;
  onClipNameChange: (v: string) => void;
  clipName2: string;
  onClipName2Change: (v: string) => void;
  clipType: string;
  onClipTypeChange: (v: string) => void;
  vaeName: string;
  onVaeNameChange: (v: string) => void;
  loading?: boolean;
  disabled?: boolean;
  offline?: boolean;
  familyName?: string | null;
  mapped?: boolean;
  missing?: MissingSlot[];
  onAddModel?: (preferType?: string) => void;
  needsGguf?: boolean;
  /** Soft offer when family supports GGUF but the node pack isn't installed */
  offerGguf?: boolean;
};

function isMissing(missing: MissingSlot[] | undefined, kind: MissingSlot['kind'], key?: string) {
  if (!missing?.length) return false;
  return missing.some((m) => m.kind === kind && (key ? m.key === key : true));
}

export function ModelStackPanel({
  catalog,
  mode,
  onModeChange,
  checkpoint,
  onCheckpointChange,
  unet,
  onUnetChange,
  clipName,
  onClipNameChange,
  clipName2,
  onClipName2Change,
  clipType,
  onClipTypeChange,
  vaeName,
  onVaeNameChange,
  loading,
  disabled,
  offline,
  familyName,
  mapped,
  missing = [],
  onAddModel,
  needsGguf,
  offerGguf,
}: Props) {
  const dualTypes =
    catalog.dual_clip_types.length > 0 ? catalog.dual_clip_types : ['flux', 'sdxl', 'sd3'];
  const singleTypes =
    catalog.clip_types.length > 0 ? catalog.clip_types : ['stable_diffusion', 'flux', 'sd3'];
  const typeOptions = clipName2 ? dualTypes : singleTypes;

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label>Loader</Label>
        <Select
          value={mode}
          onValueChange={(v) => onModeChange(v as ModelLoadMode)}
          disabled={disabled || offline}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="checkpoint">Checkpoint (single file)</SelectItem>
            <SelectItem value="split" disabled={!catalog.available.unet && !catalog.available.ggufUnet}>
              Split stack (diffusion + text encoder + VAE)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {needsGguf ? (
        <p className="rounded-[10px] border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] leading-snug text-foreground">
          A .gguf file is selected but ComfyUI-GGUF is not installed. Use the CLI Components menu to
          install <span className="font-mono">comfyui-gguf</span>, then restart ComfyUI.
        </p>
      ) : offerGguf ? (
        <p className="rounded-[10px] border border-border bg-secondary/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          Optional: install <span className="font-mono text-foreground">ComfyUI-GGUF</span> from the
          CLI Components menu to use quantized .gguf diffusion / text-encoder models.
        </p>
      ) : null}

      {mode === 'checkpoint' ? (
        <>
          <div className="space-y-1.5">
            <div className="flex items-stretch gap-2">
              <div className="min-w-0 flex-1">
                <ModelSelect
                  label="Checkpoint"
                  options={catalog.checkpoints}
                  value={checkpoint}
                  onChange={onCheckpointChange}
                  loading={loading}
                  disabled={disabled}
                  offline={offline}
                  onAddModel={onAddModel ? () => onAddModel('checkpoint') : undefined}
                  missing={isMissing(missing, 'checkpoint')}
                  onAddMissing={onAddModel ? () => onAddModel('checkpoint') : undefined}
                />
              </div>
              {mapped && familyName ? (
                <span
                  className={cn(
                    'mt-6 inline-flex shrink-0 items-center rounded-[10px] border border-primary/40 bg-primary/10 px-2.5 text-xs font-medium text-foreground',
                  )}
                  title="Model family"
                >
                  {familyName}
                </span>
              ) : null}
            </div>
          </div>
          <ModelSelect
            label="VAE override"
            options={catalog.vae}
            value={vaeName}
            onChange={onVaeNameChange}
            loading={loading}
            disabled={disabled}
            offline={offline}
            allowEmpty
            emptyLabel="From checkpoint"
            hint={catalog.vae.length === 0 ? 'No VAEs found in models/vae' : null}
            onAddModel={onAddModel ? () => onAddModel('vae') : undefined}
          />
        </>
      ) : (
        <>
          <div className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1">
              <ModelSelect
                label="Diffusion model"
                options={catalog.diffusion_models}
                value={unet}
                onChange={onUnetChange}
                loading={loading}
                disabled={disabled}
                offline={offline}
                hint="models/diffusion_models or models/unet (.gguf)"
                onAddModel={onAddModel ? () => onAddModel('diffusion') : undefined}
                missing={isMissing(missing, 'diffusion')}
                onAddMissing={onAddModel ? () => onAddModel('diffusion') : undefined}
              />
            </div>
            {mapped && familyName ? (
              <span
                className={cn(
                  'mt-6 inline-flex shrink-0 items-center rounded-[10px] border border-primary/40 bg-primary/10 px-2.5 text-xs font-medium text-foreground',
                )}
              >
                {familyName}
              </span>
            ) : null}
          </div>
          <ModelSelect
            label="Text encoder"
            options={catalog.text_encoders}
            value={clipName}
            onChange={onClipNameChange}
            loading={loading}
            disabled={disabled}
            offline={offline}
            hint="models/text_encoders"
            onAddModel={onAddModel ? () => onAddModel('text_encoder') : undefined}
            missing={isMissing(missing, 'text_encoder') && missing.some((m) => m.slotIndex === 0 || m.slotIndex === undefined)}
            onAddMissing={onAddModel ? () => onAddModel('text_encoder') : undefined}
          />
          <ModelSelect
            label="Text encoder 2"
            options={catalog.text_encoders}
            value={clipName2}
            onChange={onClipName2Change}
            loading={loading}
            disabled={disabled}
            offline={offline}
            allowEmpty
            emptyLabel="Single encoder"
            hint="Required for Flux DualCLIP (e.g. T5 + CLIP-L)"
            onAddModel={onAddModel ? () => onAddModel('text_encoder') : undefined}
            missing={missing.some((m) => m.kind === 'text_encoder' && m.slotIndex === 1)}
            onAddMissing={onAddModel ? () => onAddModel('text_encoder') : undefined}
          />
          <ModelSelect
            label="CLIP type"
            options={typeOptions}
            value={clipType || typeOptions[0] || 'flux'}
            onChange={onClipTypeChange}
            loading={loading}
            disabled={disabled}
            offline={offline}
          />
          <ModelSelect
            label="VAE"
            options={catalog.vae}
            value={vaeName}
            onChange={onVaeNameChange}
            loading={loading}
            disabled={disabled}
            offline={offline}
            hint="models/vae"
            onAddModel={onAddModel ? () => onAddModel('vae') : undefined}
            missing={isMissing(missing, 'vae')}
            onAddMissing={onAddModel ? () => onAddModel('vae') : undefined}
          />
        </>
      )}
    </div>
  );
}
