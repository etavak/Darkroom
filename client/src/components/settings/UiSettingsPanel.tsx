import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import type { PreviewQuality, UiSettings } from '@/lib/uiSettings';

export type SettingEntry = {
  id: string;
  label: string;
  description?: string;
  hint?: string;
  control: ReactNode;
};

type Props = {
  settings: UiSettings;
  onLivePreviewChange: (enabled: boolean) => void;
  onPreviewQualityChange: (quality: PreviewQuality) => void;
  /** When false, quality is persisted to .env and needs a ComfyUI relaunch. */
  perPromptPreview: boolean | null;
  /** Extra entries appended after the built-in preview settings. */
  extraEntries?: SettingEntry[];
};

function SettingRow({ entry }: { entry: SettingEntry }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label htmlFor={entry.id} className="normal-case tracking-normal text-foreground">
          {entry.label}
        </Label>
        {entry.description && (
          <p className="text-[11px] leading-snug text-muted-foreground">{entry.description}</p>
        )}
        {entry.hint && (
          <p className="text-[11px] leading-snug text-amber-500/90">{entry.hint}</p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">{entry.control}</div>
    </div>
  );
}

/**
 * Device-local UI settings (localStorage). Built as a list of entries so new
 * options can be added without restructuring the panel.
 */
export function UiSettingsPanel({
  settings,
  onLivePreviewChange,
  onPreviewQualityChange,
  perPromptPreview,
  extraEntries = [],
}: Props) {
  const qualityHint =
    perPromptPreview === false
      ? 'Applies next launch'
      : perPromptPreview === true
        ? 'Applied on next generate'
        : undefined;

  const entries: SettingEntry[] = [
    {
      id: 'live-preview',
      label: 'Live preview',
      description: 'Stream latent previews while generating. Progress still updates when off.',
      control: (
        <Switch
          id="live-preview"
          checked={settings.livePreview}
          onCheckedChange={onLivePreviewChange}
          aria-label="Live preview"
        />
      ),
    },
    {
      id: 'preview-quality',
      label: 'Preview quality',
      description: 'Fast is cheaper on the GPU; Detailed is sharper.',
      hint: qualityHint,
      control: (
        <Select
          value={settings.previewQuality}
          onValueChange={(v) => onPreviewQualityChange(v as PreviewQuality)}
        >
          <SelectTrigger id="preview-quality" className="w-[8.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fast">Fast</SelectItem>
            <SelectItem value="detailed">Detailed</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    ...extraEntries,
  ];

  return (
    <div className="flex flex-col gap-1 px-4 py-2">
      <p className="pb-1 text-[11px] text-muted-foreground">
        Saved on this device only — other phones or tablets keep their own choices.
      </p>
      {entries.map((entry, i) => (
        <div key={entry.id}>
          {i > 0 && <Separator />}
          <SettingRow entry={entry} />
        </div>
      ))}
    </div>
  );
}
