import type { ReactNode } from 'react';
import { Image as ImageIcon, Sparkles } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { PreviewQuality, UiSettings } from '@/lib/uiSettings';

export type SettingEntry = {
  id: string;
  label: string;
  description?: string;
  hint?: string;
  icon?: ReactNode;
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
    <div className="setting-row flex items-start justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {entry.icon && (
          <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
            {entry.icon}
          </span>
        )}
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor={entry.id} className="normal-case tracking-normal text-foreground">
            {entry.label}
          </Label>
          {entry.description && (
            <p className="text-[11px] leading-snug text-muted-foreground">{entry.description}</p>
          )}
          {entry.hint && (
            <p className="text-[11px] leading-snug text-primary/90">{entry.hint}</p>
          )}
        </div>
      </div>
      <div className="shrink-0 pt-0.5">{entry.control}</div>
    </div>
  );
}

function SettingsGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  );
}

/** Device-local UI settings (localStorage). */
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

  const previewEntries: SettingEntry[] = [
    {
      id: 'live-preview',
      label: 'Live preview',
      description: 'Stream latent previews while generating. Progress still updates when off.',
      icon: <Sparkles />,
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
      icon: <ImageIcon />,
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
    <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
      <p className="text-[11px] text-muted-foreground">
        Saved on this device only — other phones or tablets keep their own choices.
      </p>
      <SettingsGroup label="Preview">
        {previewEntries.map((entry) => (
          <SettingRow key={entry.id} entry={entry} />
        ))}
      </SettingsGroup>
    </div>
  );
}
