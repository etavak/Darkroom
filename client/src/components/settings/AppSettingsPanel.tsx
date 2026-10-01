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
  Search,
  Shield,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
} from 'lucide-react';
import {
  SettingRow,
  SettingsGroup,
  type SettingEntry,
  type SettingScope,
} from '@/components/settings/SettingPrimitives';
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

export type PrefCategory =
  | 'general'
  | 'interface'
  | 'generation'
  | 'performance'
  | 'models'
  | 'network'
  | 'advanced';

const CATEGORIES: { id: PrefCategory; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'interface', label: 'Interface' },
  { id: 'generation', label: 'Generation' },
  { id: 'performance', label: 'Performance' },
  { id: 'models', label: 'Models' },
  { id: 'network', label: 'Network' },
  { id: 'advanced', label: 'Advanced' },
];

type PrefEntry = SettingEntry & {
  category: PrefCategory;
  scope: SettingScope;
};

type Props = {
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

function matchesQuery(entry: PrefEntry, q: string): boolean {
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
 * Photoshop-style Preferences: category list + searchable settings.
 * Changes apply instantly (localStorage / server PATCH).
 */
export function AppSettingsPanel({
  ui,
  onUiPatch,
  onLivePreviewChange,
  onPreviewQualityChange,
  perPromptPreview,
  server,
  serverHints,
  diskUsage,
  serverLoading,
  onServerPatch,
  onCopyDiagnostics,
  onBackupNow,
}: Props) {
  const [category, setCategory] = useState<PrefCategory>('general');
  const [query, setQuery] = useState('');
  const [diagFlash, setDiagFlash] = useState<string | null>(null);
  const [backupFlash, setBackupFlash] = useState<string | null>(null);
  const [foldersText, setFoldersText] = useState(server.extraModelFolders.join('\n'));

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
        description: 'Download metadata / previews when installing models',
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
        id: 'experimental',
        category: 'advanced',
        scope: 'server',
        label: 'Experimental features',
        description: 'Enable unfinished UI / workflow experiments',
        icon: <Sparkles />,
        control: (
          <Switch
            id="experimental"
            checked={server.experimentalFeatures}
            onCheckedChange={(v) => void onServerPatch({ experimentalFeatures: v })}
          />
        ),
      },
      {
        id: 'auto-backup',
        category: 'advanced',
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
        category: 'advanced',
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
        category: 'advanced',
        scope: 'server',
        label: 'Disk usage',
        description: diskUsage
          ? `${formatBytes(diskUsage.totalBytes)} · images ${formatBytes(diskUsage.imagesBytes)} · trash ${formatBytes(diskUsage.trashBytes)} · backups ${formatBytes(diskUsage.backupsBytes)}`
          : 'Unavailable',
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
    foldersText,
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

  const searching = query.trim().length > 0;
  const visible = useMemo(() => {
    if (searching) return entries.filter((e) => matchesQuery(e, query));
    return entries.filter((e) => e.category === category);
  }, [category, entries, query, searching]);

  const categoryCounts = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    const counts: Partial<Record<PrefCategory, number>> = {};
    for (const e of entries) {
      if (matchesQuery(e, q)) counts[e.category] = (counts[e.category] ?? 0) + 1;
    }
    return counts;
  }, [entries, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search preferences…"
            className="h-8 pl-8 text-sm"
            aria-label="Search preferences"
          />
        </div>
        {serverLoading && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">Loading server settings…</p>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[9.5rem] shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-muted/20 p-2">
          {CATEGORIES.map((c) => {
            const count = categoryCounts?.[c.id];
            const active = !searching && category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCategory(c.id);
                  if (searching) setQuery('');
                }}
                className={cn(
                  'rounded px-2.5 py-1.5 text-left text-[12px] transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground/80 hover:bg-secondary',
                )}
              >
                <span className="flex items-center justify-between gap-1">
                  {c.label}
                  {typeof count === 'number' && count > 0 && (
                    <span className="font-mono text-[10px] opacity-70">{count}</span>
                  )}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          <p className="settings-intro">
            {searching
              ? `Results for “${query.trim()}” — changes apply immediately.`
              : 'Changes apply immediately. Tags show whether a setting is local or shared.'}
          </p>
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No matching settings</p>
          ) : searching ? (
            <div className="divide-y divide-border/40">
              {visible.map((e) => (
                <SettingRow key={e.id} entry={e} />
              ))}
            </div>
          ) : (
            <SettingsGroup label={CATEGORIES.find((c) => c.id === category)?.label ?? ''}>
              {visible.map((e) => (
                <SettingRow key={e.id} entry={e} />
              ))}
            </SettingsGroup>
          )}
        </div>
      </div>
    </div>
  );
}
