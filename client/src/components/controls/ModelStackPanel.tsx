import { useMemo, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ModelSelect } from '@/components/controls/ModelSelect';
import type { MissingSlot } from '@/lib/modelReadiness';
import {
  deleteModelProfile,
  loadModelProfiles,
  saveModelProfiles,
  shortModelName,
  upsertModelProfile,
  type ModelProfile,
} from '@/lib/modelProfiles';
import type { LoraSettings, ModelCatalog, ModelLoadMode } from '@/types/generation';

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
  clipTypeOverride: boolean;
  onClipTypeOverrideChange: (v: boolean) => void;
  vaeName: string;
  onVaeNameChange: (v: string) => void;
  loras: LoraSettings[];
  onLorasChange: (v: LoraSettings[]) => void;
  loading?: boolean;
  disabled?: boolean;
  offline?: boolean;
  familyName?: string | null;
  mapped?: boolean;
  /** How many text encoders this family needs (0 = generic) */
  textEncoderCount?: number;
  te1Hint?: string | null;
  te2Hint?: string | null;
  vaeHint?: string | null;
  missing?: MissingSlot[];
  onAddModel?: (preferType?: string) => void;
  needsGguf?: boolean;
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
  clipTypeOverride,
  onClipTypeOverrideChange,
  vaeName,
  onVaeNameChange,
  loras,
  onLorasChange,
  loading,
  disabled,
  offline,
  familyName,
  mapped,
  textEncoderCount = 1,
  te1Hint,
  te2Hint,
  vaeHint,
  missing = [],
  onAddModel,
  needsGguf,
  offerGguf,
}: Props) {
  const [profiles, setProfiles] = useState<ModelProfile[]>(() => loadModelProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  const dualTypes =
    catalog.dual_clip_types.length > 0 ? catalog.dual_clip_types : ['flux', 'sdxl', 'sd3'];
  const singleTypes =
    catalog.clip_types.length > 0 ? catalog.clip_types : ['stable_diffusion', 'flux', 'sd3'];
  const needsTe2 = textEncoderCount >= 2;
  const typeOptions = needsTe2 || clipName2 ? dualTypes : singleTypes;

  const te1Label =
    textEncoderCount >= 1 && missing.find((m) => m.slotIndex === 0)?.label
      ? missing.find((m) => m.slotIndex === 0)!.label
      : 'Text encoder';
  const te2Label =
    missing.find((m) => m.slotIndex === 1)?.label ?? 'Text encoder 2';

  const familyBadge = mapped && familyName ? familyName : null;

  const persist = (next: ModelProfile[]) => {
    setProfiles(next);
    saveModelProfiles(next);
  };

  const applyProfile = (id: string) => {
    setSelectedProfileId(id);
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    onModeChange(p.mode);
    onCheckpointChange(p.checkpoint);
    onUnetChange(p.unet);
    onClipNameChange(p.clipName);
    onClipName2Change(p.clipName2);
    onClipTypeChange(p.clipType);
    onClipTypeOverrideChange(Boolean(p.clipTypeOverride));
    onVaeNameChange(p.vaeName);
    onLorasChange(p.loras ?? []);
  };

  const handleSaveProfile = () => {
    const name = saveName.trim();
    if (!name) return;
    const next = upsertModelProfile(profiles, {
      name,
      mode,
      checkpoint,
      unet,
      clipName,
      clipName2,
      clipType,
      clipTypeOverride,
      vaeName,
      loras,
    });
    persist(next);
    const created = next.find((p) => p.name === name);
    if (created) setSelectedProfileId(created.id);
    setSaveName('');
    setSaving(false);
  };

  const profileOptions = useMemo(
    () => [...profiles].sort((a, b) => a.name.localeCompare(b.name)),
    [profiles],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label>Profile</Label>
        <div className="flex gap-1.5">
          <Select
            value={selectedProfileId || '__none__'}
            onValueChange={(v) => {
              if (v === '__none__') {
                setSelectedProfileId('');
                return;
              }
              if (v === '__save__') {
                setSaving(true);
                setSaveName(
                  mode === 'split'
                    ? shortModelName(unet || 'Split stack')
                    : shortModelName(checkpoint || 'Checkpoint'),
                );
                return;
              }
              applyProfile(v);
            }}
            disabled={disabled || offline}
          >
            <SelectTrigger className="min-w-0 flex-1">
              <SelectValue placeholder="No profile" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No profile</SelectItem>
              {profileOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
              <SelectItem value="__save__">Save current as…</SelectItem>
            </SelectContent>
          </Select>
          {selectedProfileId ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
              disabled={disabled}
              title="Delete profile"
              onClick={() => {
                persist(deleteModelProfile(profiles, selectedProfileId));
                setSelectedProfileId('');
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
        {saving ? (
          <div className="flex gap-1.5">
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Profile name"
              className="h-8"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveProfile();
                if (e.key === 'Escape') setSaving(false);
              }}
              autoFocus
            />
            <Button
              type="button"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleSaveProfile}
              disabled={!saveName.trim()}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

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
            <SelectItem
              value="split"
              disabled={!catalog.available.unet && !catalog.available.ggufUnet}
            >
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
          <ModelSelect
            label="Checkpoint"
            badge={familyBadge}
            options={catalog.checkpoints}
            value={checkpoint}
            onChange={onCheckpointChange}
            loading={loading}
            disabled={disabled}
            offline={offline}
            hint="models/checkpoints"
            onAddModel={onAddModel ? () => onAddModel('checkpoint') : undefined}
            missing={isMissing(missing, 'checkpoint')}
            onAddMissing={onAddModel ? () => onAddModel('checkpoint') : undefined}
          />
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
            hint="models/vae"
            onAddModel={onAddModel ? () => onAddModel('vae') : undefined}
          />
        </>
      ) : (
        <>
          <ModelSelect
            label="Diffusion model"
            badge={familyBadge}
            options={catalog.diffusion_models}
            value={unet}
            onChange={onUnetChange}
            loading={loading}
            disabled={disabled}
            offline={offline}
            hint="models/diffusion_models or models/unet"
            onAddModel={onAddModel ? () => onAddModel('diffusion') : undefined}
            missing={isMissing(missing, 'diffusion')}
            onAddMissing={onAddModel ? () => onAddModel('diffusion') : undefined}
          />
          <ModelSelect
            label={te1Label}
            options={catalog.text_encoders}
            value={clipName}
            onChange={onClipNameChange}
            loading={loading}
            disabled={disabled}
            offline={offline}
            hint={te1Hint || 'models/text_encoders'}
            onAddModel={onAddModel ? () => onAddModel('text_encoder') : undefined}
            missing={
              isMissing(missing, 'text_encoder') &&
              missing.some((m) => m.slotIndex === 0 || m.slotIndex === undefined)
            }
            onAddMissing={onAddModel ? () => onAddModel('text_encoder') : undefined}
          />
          {needsTe2 ? (
            <ModelSelect
              label={te2Label}
              options={catalog.text_encoders}
              value={clipName2}
              onChange={onClipName2Change}
              loading={loading}
              disabled={disabled}
              offline={offline}
              hint={te2Hint || 'models/text_encoders'}
              onAddModel={onAddModel ? () => onAddModel('text_encoder') : undefined}
              missing={missing.some((m) => m.kind === 'text_encoder' && m.slotIndex === 1)}
              onAddMissing={onAddModel ? () => onAddModel('text_encoder') : undefined}
            />
          ) : null}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>CLIP type</Label>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={clipTypeOverride}
                  onChange={(e) => onClipTypeOverrideChange(e.target.checked)}
                  disabled={disabled}
                />
                Override
              </label>
            </div>
            {clipTypeOverride ? (
              <Select
                value={clipType || typeOptions[0] || 'flux'}
                onValueChange={onClipTypeChange}
                disabled={disabled || offline}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="rounded-[8px] border border-border/60 bg-secondary/30 px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
                Auto · {clipType || typeOptions[0] || 'flux'}
                {familyBadge ? ` (${familyBadge})` : ''}
              </p>
            )}
          </div>

          <ModelSelect
            label="VAE"
            options={catalog.vae}
            value={vaeName}
            onChange={onVaeNameChange}
            loading={loading}
            disabled={disabled}
            offline={offline}
            hint={vaeHint || 'models/vae'}
            onAddModel={onAddModel ? () => onAddModel('vae') : undefined}
            missing={isMissing(missing, 'vae')}
            onAddMissing={onAddModel ? () => onAddModel('vae') : undefined}
          />
        </>
      )}

      {!saving && profiles.length === 0 ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => {
            setSaving(true);
            setSaveName(
              mode === 'split'
                ? shortModelName(unet || 'Split stack')
                : shortModelName(checkpoint || 'Checkpoint'),
            );
          }}
          disabled={disabled}
        >
          <Plus className="h-3 w-3" />
          Save model profile
        </button>
      ) : null}
    </div>
  );
}
