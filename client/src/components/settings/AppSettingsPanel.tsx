import { useEffect, useMemo, useState } from 'react';
import {
  Aperture,
  Copy,
  Database,
  FolderOpen,
  Gauge,
  HardDrive,
  Image as ImageIcon,
  Keyboard,
  LayoutPanelLeft,
  Loader,
  Moon,
  Network,
  Shield,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from 'lucide-react';
import { type SettingEntry, type SettingScope } from '@/components/settings/SettingPrimitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type {
  CanvasBackground,
  HistoryPosition,
  Palette,
  PreviewQuality,
  ShortcutAction,
  UiScale,
  UiSettings,
} from '@/lib/uiSettings';
import type {
  DeleteMode,
  DiskUsageInfo,
  LogLevel,
  ServerSettings,
  VramMode,
} from '@/types/serverSettings';
import { cn } from '@/lib/utils';
import {
  fetchAuthStatus,
  fetchLanAccess,
  fetchLanDevices,
  fetchVersionInfo,
  checkUpdatesApi,
  testEnhanceApi,
  regenerateLanPin,
  revokeLanDevice,
  signOutThisDevice,
  type LanAccessInfo,
  type LanDevice,
  type UpdateCheck,
  type VersionInfo,
} from '@/lib/api';

export type PrefCategory =
  | 'general'
  | 'interface'
  | 'generation'
  | 'performance'
  | 'models'
  | 'enhance'
  | 'network'
  | 'updates'
  | 'advanced';

export const PREF_CATEGORIES: { id: PrefCategory; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'interface', label: 'Appearance' },
  { id: 'generation', label: 'Generation' },
  { id: 'performance', label: 'Performance' },
  { id: 'models', label: 'Models & folders' },
  { id: 'enhance', label: 'Enhance' },
  { id: 'network', label: 'Network' },
  { id: 'updates', label: 'Updates & backups' },
  { id: 'advanced', label: 'Advanced' },
];

export type PrefEntry = SettingEntry & {
  category: PrefCategory;
  scope: SettingScope;
};

export type PreferenceProps = {
  ui: UiSettings;
  onUiPatch: (partial: Partial<UiSettings>) => void;
  onLivePreviewChange: (enabled: boolean) => void;
  onPreviewQualityChange: (quality: PreviewQuality) => void;
  perPromptPreview: boolean | null;
  server: ServerSettings;
  serverHints: Partial<Record<keyof ServerSettings, string>>;
  diskUsage: DiskUsageInfo | null;
  serverLoading?: boolean;
  onServerPatch: (partial: Partial<ServerSettings>) => void | Promise<unknown>;
  onCopyDiagnostics: () => Promise<void>;
  onBackupNow: () => Promise<void>;
  onEmptyTrash: () => Promise<number>;
};

const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  generate: 'Generate',
  cancel: 'Cancel',
  prevHistory: 'Previous history',
  nextHistory: 'Next history',
  favorite: 'Favorite',
  openSettings: 'Open preferences',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Proportions of images, trash, backups and the database. */
function DiskBar({ usage }: { usage: DiskUsageInfo }) {
  const parts = [
    { k: 'Images', v: usage.imagesBytes, c: 'var(--s-accent)' },
    { k: 'Trash', v: usage.trashBytes, c: '#e5534b' },
    { k: 'Backups', v: usage.backupsBytes, c: '#6fa8dc' },
    { k: 'Database', v: usage.dbBytes, c: 'var(--s-muted)' },
  ];
  const total = Math.max(1, usage.totalBytes);
  return (
    <span className="mt-1.5 flex h-2 w-full max-w-[320px] overflow-hidden rounded-full" style={{ background: 'var(--s-raised2)' }} role="img" aria-label="Disk usage">
      {parts.map((p) =>
        p.v > 0 ? <span key={p.k} data-tip={`${p.k} · ${formatBytes(p.v)}`} style={{ width: `${Math.max(1.5, (p.v / total) * 100)}%`, background: p.c }} /> : null,
      )}
    </span>
  );
}

function CompactNumber({
  id,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
  className,
}: {
  id: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (n: number) => void;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Input
        id={id}
        type="number"
        className="h-8 w-20 font-mono"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}

export function matchesQuery(entry: PrefEntry, q: string): boolean {
  if (!q) return true;
  const hay = [
    entry.label,
    entry.description ?? '',
    entry.hint ?? '',
    ...(entry.keywords ?? []),
    entry.scope === 'device' ? 'this device' : 'all devices',
  ]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

/**
 * Every preference as data (label, description, live control) for the full-screen
 * Preferences, on the computer and on phones.
 */
export function usePreferenceEntries({
  ui,
  onUiPatch,
  onLivePreviewChange,
  onPreviewQualityChange,
  perPromptPreview,
  server,
  serverHints,
  diskUsage,
  onServerPatch,
  onCopyDiagnostics,
  onBackupNow,
  onEmptyTrash,
}: PreferenceProps): PrefEntry[] {
  const [diagFlash, setDiagFlash] = useState<string | null>(null);
  const [backupFlash, setBackupFlash] = useState<string | null>(null);
  const [foldersText, setFoldersText] = useState(server.extraModelFolders.join('\n'));
  const [keyDraft, setKeyDraft] = useState('');
  const [keyTest, setKeyTest] = useState<{ busy: boolean; ok?: boolean; message?: string } | null>(null);
  const [trashState, setTrashState] = useState<'idle' | 'confirm' | 'busy' | string>('idle');
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [update, setUpdate] = useState<{ busy: boolean; result?: UpdateCheck } | null>(null);
  const [lan, setLan] = useState<LanAccessInfo | null>(null);
  /** host = the computer running Darkroom; guest = a phone / other computer signed in with the PIN */
  const [role, setRole] = useState<'host' | 'guest' | null>(null);
  const [devices, setDevices] = useState<LanDevice[]>([]);

  // PIN, URLs and devices only answer on the computer running Darkroom (403 elsewhere)
  useEffect(() => {
    fetchAuthStatus()
      .then((st) => {
        setRole(st.local ? 'host' : 'guest');
        if (!st.local) return;
        fetchLanAccess()
          .then(setLan)
          .catch(() => setLan(null));
        fetchLanDevices()
          .then((r) => setDevices(r.items))
          .catch(() => setDevices([]));
      })
      .catch(() => setRole(null));
  }, []);

  useEffect(() => {
    fetchVersionInfo()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  const runUpdateCheck = (force: boolean) => {
    setUpdate({ busy: true });
    checkUpdatesApi(force)
      .then((result) => setUpdate({ busy: false, result }))
      .catch(() => setUpdate({ busy: false, result: undefined }));
  };

  useEffect(() => {
    setFoldersText(server.extraModelFolders.join('\n'));
  }, [server.extraModelFolders]);

  const qualityHint =
    perPromptPreview === false
      ? 'Applies next launch'
      : perPromptPreview === true
        ? 'Applied on next generate'
        : undefined;

  const entries: PrefEntry[] = useMemo(() => {
    const list: PrefEntry[] = [
      // —— General ——
      {
        id: 'jump-newest',
        category: 'general',
        scope: 'device',
        label: 'Jump to newest',
        description: 'Select the latest result after each generate',
        icon: <Zap />,
        control: (
          <Switch
            id="jump-newest"
            checked={ui.jumpToNewest}
            onCheckedChange={(v) => onUiPatch({ jumpToNewest: v })}
          />
        ),
      },
      {
        id: 'confirm-delete',
        category: 'general',
        scope: 'device',
        label: 'Confirm before delete',
        description: 'Ask before removing history items',
        icon: <Trash2 />,
        control: (
          <Switch
            id="confirm-delete"
            checked={ui.confirmDelete}
            onCheckedChange={(v) => onUiPatch({ confirmDelete: v })}
          />
        ),
      },
      {
        id: 'delete-mode',
        category: 'general',
        scope: 'server',
        label: 'Delete mode',
        description: 'Trash keeps files recoverable under data/trash',
        icon: <Trash2 />,
        control: (
          <Select
            value={server.deleteMode}
            onValueChange={(v) => void onServerPatch({ deleteMode: v as DeleteMode })}
          >
            <SelectTrigger id="delete-mode" className="w-[8.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trash">Move to trash</SelectItem>
              <SelectItem value="permanent">Permanent</SelectItem>
            </SelectContent>
          </Select>
        ),
      },
      {
        id: 'safe-mode',
        category: 'general',
        scope: 'server',
        label: 'Safe mode',
        description: 'Strip common rating / NSFW tags',
        icon: <Shield />,
        control: (
          <Switch
            id="safe-mode"
            checked={server.safeMode}
            onCheckedChange={(v) => void onServerPatch({ safeMode: v })}
          />
        ),
      },

      // —— Interface ——
      {
        id: 'palette',
        category: 'interface',
        scope: 'device',
        label: 'Palette',
        description: 'Darkroom is charcoal and amber; Night is ink blue and cream',
        icon: <Moon />,
        keywords: ['theme', 'colour', 'color', 'night', 'dark'],
        control: (
          <Select value={ui.palette} onValueChange={(v) => onUiPatch({ palette: v as Palette })}>
            <SelectTrigger id="palette" className="w-[8.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="darkroom">Darkroom</SelectItem>
              <SelectItem value="night">Night</SelectItem>
            </SelectContent>
          </Select>
        ),
      },
      {
        id: 'canvas-background',
        category: 'interface',
        scope: 'device',
        label: 'Canvas background',
        description: 'Fill behind the preview image',
        keywords: ['theme', 'neutral', 'gray', 'grey', 'black', 'stage'],
        icon: <ImageIcon />,
        control: (
          <Select
            value={ui.canvasBackground}
            onValueChange={(v) => onUiPatch({ canvasBackground: v as CanvasBackground })}
          >
            <SelectTrigger id="canvas-background" className="w-[8.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="theme">Theme</SelectItem>
              <SelectItem value="neutral">Neutral gray</SelectItem>
              <SelectItem value="black">Black</SelectItem>
            </SelectContent>
          </Select>
        ),
      },
      {
        id: 'ui-scale',
        category: 'interface',
        scope: 'device',
        label: 'UI scale',
        description: 'Enlarge controls on tablets or shrink on dense screens',
        icon: <Gauge />,
        control: (
          <Select
            value={String(ui.uiScale)}
            onValueChange={(v) => onUiPatch({ uiScale: Number(v) as UiScale })}
          >
            <SelectTrigger id="ui-scale" className="w-[8.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.85">Compact</SelectItem>
              <SelectItem value="1">Default</SelectItem>
              <SelectItem value="1.1">Large</SelectItem>
              <SelectItem value="1.25">Extra large</SelectItem>
            </SelectContent>
          </Select>
        ),
      },
      {
        id: 'reduce-motion',
        category: 'interface',
        scope: 'device',
        label: 'Reduce motion',
        description: 'Disable transitions and animations',
        icon: <Moon />,
        control: (
          <Switch
            id="reduce-motion"
            checked={ui.reduceMotion}
            onCheckedChange={(v) => onUiPatch({ reduceMotion: v })}
          />
        ),
      },
      {
        id: 'atmosphere',
        category: 'interface',
        scope: 'device',
        label: 'Grain / glow',
        description: 'Intensity of page grain and soft glow',
        icon: <Aperture />,
        control: (
          <div className="flex w-[8.5rem] items-center gap-2">
            <input
              id="atmosphere"
              type="range"
              min={0}
              max={100}
              value={ui.atmosphereIntensity}
              onChange={(e) => onUiPatch({ atmosphereIntensity: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <span className="w-8 text-right font-mono text-[10px] text-muted-foreground">
              {ui.atmosphereIntensity}
            </span>
          </div>
        ),
      },
      {
        id: 'history-position',
        category: 'interface',
        scope: 'device',
        label: 'History position',
        description: 'Where the gallery sits on desktop',
        icon: <LayoutPanelLeft />,
        control: (
          <Select
            value={ui.historyPosition}
            onValueChange={(v) => onUiPatch({ historyPosition: v as HistoryPosition })}
          >
            <SelectTrigger id="history-position" className="w-[8.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="right">Right</SelectItem>
              <SelectItem value="left">Left</SelectItem>
              <SelectItem value="bottom">Bottom</SelectItem>
              <SelectItem value="hidden">Hidden</SelectItem>
            </SelectContent>
          </Select>
        ),
      },
      {
        id: 'resizable-panels',
        category: 'interface',
        scope: 'device',
        label: 'Resizable panels',
        description: 'Drag the edges of side panels to resize',
        icon: <LayoutPanelLeft />,
        control: (
          <Switch
            id="resizable-panels"
            checked={ui.resizablePanels}
            onCheckedChange={(v) => onUiPatch({ resizablePanels: v })}
          />
        ),
      },

      // —— Generation ——
      {
        id: 'live-preview',
        category: 'generation',
        scope: 'device',
        label: 'Live preview',
        description: 'Stream latent previews while generating',
        icon: <Sparkles />,
        control: (
          <Switch
            id="live-preview"
            checked={ui.livePreview}
            onCheckedChange={onLivePreviewChange}
          />
        ),
      },
      {
        id: 'preview-quality',
        category: 'generation',
        scope: 'device',
        label: 'Preview quality',
        description: 'Fast is cheaper on the GPU; Detailed is sharper',
        hint: qualityHint,
        icon: <ImageIcon />,
        control: (
          <Select
            value={ui.previewQuality}
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
      {
        id: 'generate-forever',
        category: 'generation',
        scope: 'server',
        label: 'Generate forever',
        description: 'Keep queueing the same job with a new seed',
        icon: <Loader />,
        control: (
          <Switch
            id="generate-forever"
            checked={server.generateForever}
            onCheckedChange={(v) => void onServerPatch({ generateForever: v })}
          />
        ),
      },
      {
        id: 'max-queue',
        category: 'generation',
        scope: 'server',
        label: 'Max queue length',
        description: 'Reject new jobs beyond this count',
        icon: <Gauge />,
        control: (
          <CompactNumber
            id="max-queue"
            value={server.maxQueueLength}
            min={1}
            max={100}
            onChange={(n) => void onServerPatch({ maxQueueLength: n })}
          />
        ),
      },
      {
        id: 'default-upscaler',
        category: 'generation',
        scope: 'server',
        label: 'Default upscaler',
        description: 'Model name used when upscale is enabled',
        icon: <ImageIcon />,
        control: (
          <Input
            id="default-upscaler"
            className="h-8 w-[8.5rem] text-xs"
            placeholder="model.pt"
            value={server.defaultUpscaler}
            onChange={(e) => void onServerPatch({ defaultUpscaler: e.target.value })}
          />
        ),
      },
      {
        id: 'default-upscale-scale',
        category: 'generation',
        scope: 'server',
        label: 'Default upscale scale',
        description: 'Preselected in the Upscale menu',
        icon: <ImageIcon />,
        control: (
          <CompactNumber
            id="default-upscale-scale"
            value={server.defaultUpscaleScale}
            min={1}
            max={4}
            step={0.1}
            onChange={(n) => void onServerPatch({ defaultUpscaleScale: n })}
            suffix="×"
          />
        ),
      },
      {
        id: 'detailer-default',
        category: 'generation',
        scope: 'server',
        label: 'Detailer default',
        description: 'Run face detailer on new jobs',
        icon: <Wand2 />,
        control: (
          <Switch
            id="detailer-default"
            checked={server.detailerDefault}
            onCheckedChange={(v) => void onServerPatch({ detailerDefault: v })}
          />
        ),
      },
      {
        id: 'prompt-dedupe',
        category: 'generation',
        scope: 'server',
        label: 'Dedupe tags',
        description: 'Remove duplicate prompt tags',
        icon: <Wand2 />,
        control: (
          <Switch
            id="prompt-dedupe"
            checked={server.promptCleanupDedupe}
            onCheckedChange={(v) => void onServerPatch({ promptCleanupDedupe: v })}
          />
        ),
      },
      {
        id: 'prompt-normalize',
        category: 'generation',
        scope: 'server',
        label: 'Normalize spacing',
        description: 'Collapse whitespace around commas',
        icon: <Wand2 />,
        control: (
          <Switch
            id="prompt-normalize"
            checked={server.promptCleanupNormalize}
            onCheckedChange={(v) => void onServerPatch({ promptCleanupNormalize: v })}
          />
        ),
      },
      {
        id: 'embed-png-metadata',
        category: 'generation',
        scope: 'server',
        label: 'Embed PNG metadata',
        description: 'Write prompt and settings into saved PNG files',
        keywords: ['png', 'exif', 'parameters', 'drag'],
        icon: <ImageIcon />,
        control: (
          <Switch
            id="embed-png-metadata"
            checked={server.embedPngMetadata}
            onCheckedChange={(v) => void onServerPatch({ embedPngMetadata: v })}
          />
        ),
      },

      // —— Performance ——
      {
        id: 'vram-mode',
        category: 'performance',
        scope: 'server',
        label: 'VRAM mode',
        description: 'Maps to ComfyUI --lowvram / --normalvram / --highvram',
        hint: serverHints.vramMode,
        icon: <HardDrive />,
        control: (
          <Select
            value={server.vramMode}
            onValueChange={(v) => void onServerPatch({ vramMode: v as VramMode })}
          >
            <SelectTrigger id="vram-mode" className="w-[8.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        ),
      },
      {
        id: 'unload-idle',
        category: 'performance',
        scope: 'server',
        label: 'Unload after idle',
        description: 'POST /free when idle this many minutes (0 = off)',
        hint: serverHints.unloadIdleMinutes,
        icon: <Loader />,
        control: (
          <CompactNumber
            id="unload-idle"
            value={server.unloadIdleMinutes}
            min={0}
            max={240}
            onChange={(n) => void onServerPatch({ unloadIdleMinutes: n })}
            suffix="min"
          />
        ),
      },

      // —— Models ——
      {
        id: 'extra-folders',
        category: 'models',
        scope: 'server',
        label: 'Extra model folders',
        description: 'One path per line. Writes ComfyUI extra_model_paths.yaml.',
        hint: serverHints.extraModelFolders,
        keywords: ['checkpoint', 'lora', 'paths'],
        icon: <FolderOpen />,
        control: (
          <textarea
            id="extra-folders"
            className="min-h-[4.5rem] w-[14rem] rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs"
            value={foldersText}
            onChange={(e) => setFoldersText(e.target.value)}
            onBlur={() => {
              const folders = foldersText
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean);
              void onServerPatch({ extraModelFolders: folders });
            }}
          />
        ),
      },
      {
        id: 'civitai-auto',
        category: 'models',
        scope: 'server',
        label: 'Civitai auto-fetch',
        description: 'Save trigger words + preview next to installed models (local files are matched by hash)',
        icon: <Database />,
        control: (
          <Switch
            id="civitai-auto"
            checked={server.civitaiAutoFetch}
            onCheckedChange={(v) => void onServerPatch({ civitaiAutoFetch: v })}
          />
        ),
      },
      {
        id: 'wildcards-folder',
        category: 'models',
        scope: 'server',
        label: 'Wildcards folder',
        description: 'Path for wildcard text files',
        icon: <FolderOpen />,
        control: (
          <Input
            id="wildcards-folder"
            className="h-8 w-[8.5rem] text-xs"
            placeholder="/path/to/wildcards"
            value={server.wildcardsFolder}
            onChange={(e) => void onServerPatch({ wildcardsFolder: e.target.value })}
          />
        ),
      },
      {
        id: 'enhance-api-url',
        category: 'enhance',
        scope: 'server',
        label: 'Enhance API URL',
        description: 'OpenAI-compatible base URL (…/v1). Leave blank to hide Enhance.',
        keywords: ['openai', 'llm', 'prompt'],
        icon: <Sparkles />,
        control: (
          <Input
            id="enhance-api-url"
            className="h-8 w-[12rem] text-xs"
            placeholder="https://api.openai.com/v1"
            value={server.enhanceApiUrl}
            onChange={(e) => void onServerPatch({ enhanceApiUrl: e.target.value })}
          />
        ),
      },
      {
        id: 'enhance-api-key',
        category: 'enhance',
        scope: 'server',
        label: 'Enhance API key',
        description: server.enhanceApiKeySet
          ? 'Saved on the computer running Darkroom — it is never shown again.'
          : 'Bearer token for the API. Stored on the computer running Darkroom and never sent back to browsers.',
        hint: keyTest?.busy ? 'Testing…' : keyTest?.message,
        keywords: ['openai', 'llm', 'prompt'],
        icon: <Shield />,
        control: (
          <div className="flex items-center gap-1">
            {/* Write-only: the saved key never comes back to the browser */}
            <Input
              id="enhance-api-key"
              type="password"
              className="h-8 w-[12rem] text-xs"
              placeholder={server.enhanceApiKeySet ? 'Saved — type to replace' : 'sk-…'}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onBlur={() => {
                if (!keyDraft.trim()) return;
                void onServerPatch({ enhanceApiKey: keyDraft.trim() });
                setKeyDraft('');
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs"
              disabled={keyTest?.busy || !server.enhanceApiUrl.trim()}
              data-tip={server.enhanceApiUrl.trim() ? 'Check the URL, key and model' : 'Set the API URL first'}
              onClick={() => {
                setKeyTest({ busy: true });
                testEnhanceApi()
                  .then((r) => setKeyTest({ busy: false, ok: r.ok, message: `${r.ok ? '✓' : '✕'} ${r.message}` }))
                  .catch(() => setKeyTest({ busy: false, ok: false, message: '✕ Could not run the test.' }));
              }}
            >
              Test
            </Button>
            {server.enhanceApiKeySet ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs"
                data-tip="Delete the saved key"
                onClick={() => {
                  setKeyTest(null);
                  void onServerPatch({ enhanceApiKey: '' });
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ),
      },
      {
        id: 'enhance-model',
        category: 'enhance',
        scope: 'server',
        label: 'Enhance model',
        description: 'Chat model id used by Enhance',
        keywords: ['openai', 'llm', 'prompt'],
        icon: <Sparkles />,
        control: (
          <Input
            id="enhance-model"
            className="h-8 w-[8.5rem] text-xs"
            placeholder="gpt-4o-mini"
            value={server.enhanceModel}
            onChange={(e) => void onServerPatch({ enhanceModel: e.target.value })}
          />
        ),
      },

      // —— Network ——
      {
        id: 'network-comfy',
        category: 'network',
        scope: 'server',
        label: 'ComfyUI host',
        description:
          'Host and mode (local / remote) are set in the launcher and .env (COMFY_URL, COMFY_MODE). Restart after changing.',
        keywords: ['url', 'remote', 'proxy', 'connection'],
        icon: <Network />,
        control: (
          <span className="text-[11px] text-muted-foreground">Configured at launch</span>
        ),
      },

      ...(role === 'guest'
        ? [
            {
              id: 'lan-this-device',
              category: 'network' as const,
              scope: 'device' as const,
              label: 'This device',
              description: `Signed in to Darkroom on ${window.location.host} with the PIN. Signing out means entering the PIN again next time.`,
              keywords: ['pin', 'sign out', 'log out', 'phone', 'tablet', 'lan'],
              icon: <Shield />,
              control: (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!window.confirm('Sign this device out? You’ll need the PIN to get back in.')) return;
                    void signOutThisDevice().finally(() => window.location.reload());
                  }}
                >
                  Sign out of this device
                </Button>
              ),
            },
          ]
        : [
            {
              id: 'lan-access',
              category: 'network' as const,
              scope: 'server' as const,
              label: 'Other devices',
              description: lan
                ? `Open ${lan.urls[0] ?? 'this computer’s address'} on your phone or tablet and type the code — it changes every 30 seconds, like an authenticator. Signed-in devices stay signed in. Reset signs every device out.`
                : 'Shown only on the computer running Darkroom.',
              keywords: ['pin', 'phone', 'tablet', 'lan', 'wifi', 'remote', 'password'],
              icon: <Shield />,
              control: lan ? (
                <div className="flex items-center gap-2">
                  <RotatingPin initial={lan} />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (!window.confirm('Reset the codes? Every signed-in phone and tablet will need to enter a code again.')) return;
                      void regenerateLanPin()
                        .then((next) => {
                          setLan(next);
                          setDevices([]);
                        })
                        .catch(() => {});
                    }}
                  >
                    Reset
                  </Button>
                </div>
              ) : (
                <span className="text-[11px] text-muted-foreground">—</span>
              ),
            },
            ...(role === 'host'
              ? [
                  {
                    id: 'lan-devices',
                    category: 'network' as const,
                    scope: 'server' as const,
                    label: 'Signed-in devices',
                    description: devices.length
                      ? 'Phones, tablets and other computers using Darkroom with the PIN.'
                      : 'No other devices have signed in yet.',
                    keywords: ['devices', 'sessions', 'sign out', 'phone', 'tablet'],
                    icon: <Network />,
                    control: devices.length ? (
                      <div className="flex min-w-[260px] flex-col gap-1.5">
                        {devices.map((d) => (
                          <div key={d.id} className="flex items-center justify-between gap-3">
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate text-[13px] font-semibold">{d.device}</span>
                              <span className="text-[11.5px] text-muted-foreground">
                                Last seen {new Date(d.lastSeen).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                              </span>
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void revokeLanDevice(d.id)
                                  .then(() => setDevices((list) => list.filter((x) => x.id !== d.id)))
                                  .catch(() => {})
                              }
                            >
                              Sign out
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    ),
                  },
                ]
              : []),
          ]),

      // —— Advanced ——
      {
        id: 'log-level',
        category: 'advanced',
        scope: 'server',
        label: 'Log level',
        icon: <HardDrive />,
        control: (
          <Select
            value={server.logLevel}
            onValueChange={(v) => void onServerPatch({ logLevel: v as LogLevel })}
          >
            <SelectTrigger id="log-level" className="w-[8.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="debug">Debug</SelectItem>
            </SelectContent>
          </Select>
        ),
      },
      {
        id: 'version',
        category: 'updates',
        scope: 'server',
        label: 'Version',
        description: version
          ? `Darkroom ${version.version}${version.sha ? ` · ${version.sha.slice(0, 7)}` : ''}${version.updatedAt ? ` · updated ${new Date(version.updatedAt).toLocaleDateString()}` : ''}`
          : 'Checking…',
        hint: update?.busy
          ? 'Checking GitHub…'
          : update?.result
            ? update.result.error
              ? `Couldn’t check: ${update.result.error}`
              : update.result.updateAvailable
                ? `Update available (${update.result.latest?.slice(0, 7)}). Open the launcher and choose Update.`
                : update.result.updateAvailable === false
                  ? 'You’re up to date.'
                  : `Latest is ${update.result.latest?.slice(0, 7)}. Use the launcher’s Update to install it.`
            : undefined,
        keywords: ['update', 'upgrade', 'release', 'github'],
        icon: <Aperture />,
        control: (
          <Button type="button" size="sm" variant="outline" disabled={update?.busy} onClick={() => runUpdateCheck(Boolean(update?.result))}>
            {update?.busy ? 'Checking…' : 'Check for updates'}
          </Button>
        ),
      },
      {
        id: 'auto-backup',
        category: 'updates',
        scope: 'server',
        label: 'Auto-backup',
        description: 'Snapshot DB + settings on change',
        icon: <Database />,
        control: (
          <Switch
            id="auto-backup"
            checked={server.autoBackup}
            onCheckedChange={(v) => void onServerPatch({ autoBackup: v })}
          />
        ),
      },
      {
        id: 'backup-keep',
        category: 'updates',
        scope: 'server',
        label: 'Keep backups',
        icon: <Database />,
        control: (
          <CompactNumber
            id="backup-keep"
            value={server.autoBackupKeep}
            min={1}
            max={50}
            onChange={(n) => void onServerPatch({ autoBackupKeep: n })}
          />
        ),
      },
      {
        id: 'disk-usage',
        category: 'updates',
        scope: 'server',
        label: 'Disk usage',
        description: diskUsage
          ? `${formatBytes(diskUsage.totalBytes)} · images ${formatBytes(diskUsage.imagesBytes)} · trash ${formatBytes(diskUsage.trashBytes)} · backups ${formatBytes(diskUsage.backupsBytes)}`
          : 'Unavailable',
        detail: diskUsage ? <DiskBar usage={diskUsage} /> : undefined,
        icon: <HardDrive />,
        control: (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void onBackupNow()
                .then(() => {
                  setBackupFlash('Backup saved');
                  window.setTimeout(() => setBackupFlash(null), 2000);
                })
                .catch(() => {
                  setBackupFlash('Backup failed');
                  window.setTimeout(() => setBackupFlash(null), 2000);
                });
            }}
          >
            {backupFlash ?? 'Backup now'}
          </Button>
        ),
      },
      {
        id: 'empty-trash',
        category: 'updates',
        scope: 'server',
        label: 'Trash',
        description: diskUsage
          ? diskUsage.trashBytes > 0
            ? `${formatBytes(diskUsage.trashBytes)} of deleted images. Emptying it removes them for good.`
            : 'Empty.'
          : 'Deleted images wait here until you empty it.',
        hint: trashState !== 'idle' && trashState !== 'confirm' && trashState !== 'busy' ? trashState : undefined,
        keywords: ['delete', 'space', 'disk', 'clean'],
        icon: <Trash2 />,
        control:
          role !== 'host' ? (
            <span className="text-[11px] text-muted-foreground">On the computer</span>
          ) : trashState === 'confirm' ? (
            <div className="flex items-center gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => setTrashState('idle')}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => {
                  setTrashState('busy');
                  onEmptyTrash()
                    .then((n) => setTrashState(n ? `Removed ${n} file${n === 1 ? '' : 's'}` : 'Trash was already empty'))
                    .catch(() => setTrashState('Could not empty the trash'));
                }}
              >
                Delete for good
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={trashState === 'busy' || !diskUsage?.trashBytes}
              onClick={() => setTrashState('confirm')}
            >
              {trashState === 'busy' ? 'Emptying…' : 'Empty trash'}
            </Button>
          ),
      },
      {
        id: 'diagnostics',
        category: 'advanced',
        scope: 'device',
        label: 'Diagnostics',
        description: 'Copy environment + disk + recent log tail',
        icon: <Copy />,
        control: (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void onCopyDiagnostics()
                .then(() => {
                  setDiagFlash('Copied');
                  window.setTimeout(() => setDiagFlash(null), 2000);
                })
                .catch(() => {
                  setDiagFlash('Copy failed');
                  window.setTimeout(() => setDiagFlash(null), 2000);
                });
            }}
          >
            <Copy className="mr-1 h-3.5 w-3.5" />
            {diagFlash ?? 'Copy'}
          </Button>
        ),
      },
    ];

    for (const action of Object.keys(SHORTCUT_LABELS) as ShortcutAction[]) {
      list.push({
        id: `shortcut-${action}`,
        category: 'general',
        scope: 'device',
        label: SHORTCUT_LABELS[action],
        description: 'Click the field and press the new key combo',
        keywords: ['shortcut', 'hotkey', 'keyboard'],
        icon: <Keyboard />,
        control: (
          <Input
            id={`shortcut-${action}`}
            className="h-8 w-[8.5rem] font-mono text-xs"
            value={ui.shortcuts[action]}
            onChange={(e) =>
              onUiPatch({ shortcuts: { ...ui.shortcuts, [action]: e.target.value } })
            }
            onKeyDown={(e) => {
              if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;
              e.preventDefault();
              const parts: string[] = [];
              if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
              if (e.altKey) parts.push('Alt');
              if (e.shiftKey && e.key.length !== 1) parts.push('Shift');
              let key = e.key;
              if (key === ' ') key = 'Space';
              if (key.length === 1) key = key.toUpperCase();
              parts.push(key);
              onUiPatch({ shortcuts: { ...ui.shortcuts, [action]: parts.join('+') } });
            }}
          />
        ),
      });
    }

    return list;
  }, [
    backupFlash,
    diagFlash,
    keyTest,
    trashState,
    version,
    update,
    onEmptyTrash,
    foldersText,
    keyDraft,
    lan,
    role,
    devices,
    onLivePreviewChange,
    onPreviewQualityChange,
    onBackupNow,
    onCopyDiagnostics,
    onServerPatch,
    onUiPatch,
    qualityHint,
    server,
    serverHints,
    diskUsage,
    ui,
  ]);

  return entries;
}

/** The current sign-in code with a countdown; fetches the next one when it runs out. */
function RotatingPin({ initial }: { initial: LanAccessInfo }) {
  const [info, setInfo] = useState(() => ({ ...initial, at: Date.now() }));
  const [now, setNow] = useState(() => Date.now());
  const period = (info.periodS ?? 30) * 1000;
  const left = Math.max(0, (info.expiresInMs ?? period) - (now - info.at));

  useEffect(() => setInfo({ ...initial, at: Date.now() }), [initial]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (left > 0) return;
    let cancelled = false;
    void fetchLanAccess()
      .then((next) => {
        if (!cancelled) setInfo({ ...next, at: Date.now() });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [left]);

  return (
    <span className="inline-flex flex-col items-stretch gap-1" data-tip="Type this on the phone or tablet — a new code every 30 seconds" tabIndex={0}>
      <span className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-center font-mono text-base tracking-[0.18em]">
        {info.pin.slice(0, 3)} {info.pin.slice(3)}
      </span>
      <span className="h-[3px] overflow-hidden rounded-sm" style={{ background: 'var(--s-raised2)' }} aria-label={`New code in ${Math.ceil(left / 1000)} seconds`}>
        <span className="block h-full" style={{ width: `${(left / period) * 100}%`, background: left < 6000 ? '#e2b44f' : 'var(--s-accent)', transition: 'width .25s linear' }} />
      </span>
    </span>
  );
}

