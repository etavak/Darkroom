import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdvancedSettings } from '@/components/controls/AdvancedSettings';
import { AddModelDialog } from '@/components/controls/AddModelDialog';
import { AspectRatioPresets } from '@/components/controls/AspectRatioPresets';
import { BatchControl } from '@/components/controls/BatchControl';
import { FinalPromptPreview } from '@/components/controls/FinalPromptPreview';
import { GenerateButton } from '@/components/controls/GenerateButton';
import { JobQueue, type QueuedJob } from '@/components/controls/JobQueue';
import { LoraPanel } from '@/components/controls/LoraPanel';
import { DependencyResolver } from '@/components/controls/DependencyResolver';
import { MapFamilyDialog } from '@/components/controls/MapFamilyDialog';
import { ModelStackPanel } from '@/components/controls/ModelStackPanel';
import { PanelSection } from '@/components/controls/PanelSection';
import { PromptPanel } from '@/components/controls/PromptPanel';
import { SamplerControls } from '@/components/controls/SamplerControls';
import { SeedControl } from '@/components/controls/SeedControl';
import { StyleSelect } from '@/components/controls/StyleSelect';
import { Gallery } from '@/components/gallery/Gallery';
import { AppShell } from '@/components/layout/AppShell';
import { MainStage } from '@/components/layout/MainStage';
import { SettingsPanel } from '@/components/layout/SettingsPanel';
import { PreviewCanvas } from '@/components/preview/PreviewCanvas';
import { ResultActionBar } from '@/components/preview/ResultActionBar';
import { AppSettingsPanel } from '@/components/settings/AppSettingsPanel';
import { scaleAspectPresets } from '@/constants/aspectRatios';
import { useFamilies } from '@/hooks/useFamilies';
import { useGeneration } from '@/hooks/useGeneration';
import { useHistory } from '@/hooks/useHistory';
import { useModels } from '@/hooks/useModels';
import { useServerSettings } from '@/hooks/useServerSettings';
import { useUiSettings } from '@/hooks/useUiSettings';
import {
  fetchHealth,
  fetchPreviewSettings,
  fetchSystemStats,
  mapCheckpointFamily,
  resolvePresetsApi,
  startComfyApi,
  updatePreviewQuality,
} from '@/lib/api';
import { parseImageSettings } from '@/lib/imageMeta';
import { autoPickStack, evaluateReadiness } from '@/lib/modelReadiness';
import { eventMatchesShortcut, qualityToPreviewMethod } from '@/lib/uiSettings';
import type {
  GenerationRecord,
  GenerationSettings,
  LoraSettings,
  ModelLoadMode,
  SystemStatsSummary,
} from '@/types/generation';
import type { ResolvedPresets } from '@/types/presets';

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

const emptyResolved: ResolvedPresets = {
  familyId: null,
  familyName: null,
  styleId: null,
  mapped: false,
  disableNegative: false,
  positiveTags: [],
  negativeTags: [],
  finalPositive: '',
  finalNegative: '',
  settings: { baseRes: 1024 },
  aspectPresets: scaleAspectPresets(1024),
  tagSources: [],
  tagFormat: 'underscores',
  tagsEnabled: false,
};

export default function App() {
  const { catalog, loading: modelsLoading, reload: reloadModels } = useModels();
  const { families } = useFamilies();
  const { items, loading: histLoading, reload, confirmRemove } = useHistory();
  const [comfyOk, setComfyOk] = useState<boolean | null>(null);
  const [remoteMode, setRemoteMode] = useState(false);
  const [startingComfy, setStartingComfy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uiSettingsOpen, setUiSettingsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [finalOpen, setFinalOpen] = useState(false);
  const [perPromptPreview, setPerPromptPreview] = useState<boolean | null>(null);
  const [queue, setQueue] = useState<QueuedJob[]>([]);
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('darkroom.favorites');
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  const queueBusy = useRef(false);
  const queueRef = useRef<QueuedJob[]>([]);
  queueRef.current = queue;

  const {
    settings: uiSettings,
    update: updateUiSettings,
    setLivePreview,
    setPreviewQuality,
  } = useUiSettings();

  const {
    settings: serverSettings,
    diskUsage,
    hints: serverHints,
    loading: serverSettingsLoading,
    patch: patchServerSettings,
    copyDiagnostics,
    backupNow,
  } = useServerSettings();

  const foreverRef = useRef(false);
  foreverRef.current = serverSettings.generateForever;
  const haltForeverRef = useRef(false);

  const [styleId, setStyleId] = useState<string | null>(null);
  const [dismissedPositive, setDismissedPositive] = useState<string[]>([]);
  const [dismissedNegative, setDismissedNegative] = useState<string[]>([]);
  const [resolved, setResolved] = useState<ResolvedPresets>(emptyResolved);

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [modelMode, setModelMode] = useState<ModelLoadMode>('checkpoint');
  const [checkpoint, setCheckpoint] = useState('');
  const [unet, setUnet] = useState('');
  const [clipName, setClipName] = useState('');
  const [clipName2, setClipName2] = useState('');
  const [clipType, setClipType] = useState('flux');
  const [vaeName, setVaeName] = useState('');
  const [loras, setLoras] = useState<LoraSettings[]>([]);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [aspectId, setAspectId] = useState('1:1');
  const [steps, setSteps] = useState(25);
  const [cfg, setCfg] = useState(7);
  const [clipSkip, setClipSkip] = useState<number | undefined>(undefined);
  const [guidance, setGuidance] = useState<number | undefined>(undefined);
  const [sampler, setSampler] = useState('euler');
  const [scheduler, setScheduler] = useState('normal');
  const [seed, setSeed] = useState(randomSeed);
  const [seedLocked, setSeedLocked] = useState(false);
  const [batchSize, setBatchSize] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewImages, setViewImages] = useState<string[]>([]);
  const [copyFlash, setCopyFlash] = useState<string | null>(null);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [depFamilyId, setDepFamilyId] = useState<string | null>(null);
  const [addModelPreferType, setAddModelPreferType] = useState<string | undefined>();
  const [systemStats, setSystemStats] = useState<SystemStatsSummary | null>(null);
  const lastAutopickUnet = useRef('');

  const familyMeta = useMemo(
    () => families.find((f) => f.id === resolved.familyId) ?? null,
    [families, resolved.familyId],
  );

  const styles = familyMeta?.styles ?? [];

  /** Filename used for family/preset mapping */
  const primaryModel =
    modelMode === 'split' ? unet || checkpoint : checkpoint;

  // Keep model selections valid as Comfy lists refresh
  useEffect(() => {
    if (catalog.checkpoints.length === 0) {
      if (modelMode === 'checkpoint') setCheckpoint('');
    } else if (!checkpoint || !catalog.checkpoints.includes(checkpoint)) {
      if (modelMode === 'checkpoint') setCheckpoint(catalog.checkpoints[0]);
    }

    if (catalog.diffusion_models.length === 0) {
      if (modelMode === 'split') setUnet('');
    } else if (!unet || !catalog.diffusion_models.includes(unet)) {
      if (modelMode === 'split') setUnet(catalog.diffusion_models[0]);
    }

    if (clipName && catalog.text_encoders.length > 0 && !catalog.text_encoders.includes(clipName)) {
      setClipName('');
    }
    if (clipName2 && !catalog.text_encoders.includes(clipName2)) setClipName2('');

    if (vaeName && catalog.vae.length > 0 && !catalog.vae.includes(vaeName)) {
      setVaeName('');
    }
  }, [
    catalog.checkpoints,
    catalog.diffusion_models,
    catalog.text_encoders,
    catalog.vae,
    checkpoint,
    clipName,
    clipName2,
    modelMode,
    unet,
    vaeName,
  ]);

  // Auto-pick TE/VAE from family filename hints when diffusion changes
  useEffect(() => {
    if (modelMode !== 'split' || !unet) return;
    if (lastAutopickUnet.current === unet) return;
    lastAutopickUnet.current = unet;
    const picked = autoPickStack(familyMeta, catalog, families, unet);
    if (picked.clipName) setClipName(picked.clipName);
    if (picked.clipName2) setClipName2(picked.clipName2);
    if (picked.vaeName) setVaeName(picked.vaeName);
    if (picked.clipType) setClipType(picked.clipType);
  }, [modelMode, unet, familyMeta, catalog, families]);

  // Offer split mode + GGUF-aware defaults when only diffusion models exist
  useEffect(() => {
    if (
      modelMode === 'checkpoint' &&
      catalog.checkpoints.length === 0 &&
      catalog.diffusion_models.length > 0
    ) {
      setModelMode('split');
    }
  }, [catalog.checkpoints.length, catalog.diffusion_models.length, modelMode]);

  // Resolve presets whenever inputs change
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!primaryModel) {
        setResolved(emptyResolved);
        return;
      }
      try {
        const next = await resolvePresetsApi({
          checkpoint: primaryModel,
          styleId,
          dismissedPositive,
          dismissedNegative,
          userPositive: prompt,
          userNegative: negativePrompt,
        });
        if (!cancelled) setResolved(next);
      } catch {
        if (!cancelled) setResolved(emptyResolved);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [primaryModel, styleId, dismissedPositive, dismissedNegative, prompt, negativePrompt]);

  // When family or style identity changes: apply settings + scale aspect
  const identityKey = `${resolved.familyId ?? ''}|${resolved.styleId ?? ''}|${resolved.mapped}`;
  const prevIdentity = useRef('');
  const prevFamily = useRef<string | null>(null);
  useEffect(() => {
    if (identityKey === prevIdentity.current) return;
    prevIdentity.current = identityKey;

    if (!resolved.mapped || !resolved.familyId) return;

    const familyChanged = prevFamily.current !== resolved.familyId;
    if (familyChanged) {
      prevFamily.current = resolved.familyId;
      setDismissedPositive([]);
      setDismissedNegative([]);
      const def = familyMeta?.defaultStyle ?? resolved.styleId;
      if (def && def !== styleId) setStyleId(def);
    } else if (!styleId && resolved.styleId) {
      setStyleId(resolved.styleId);
    }

    const s = resolved.settings;
    if (typeof s.cfg === 'number') setCfg(s.cfg);
    if (typeof s.clipSkip === 'number') setClipSkip(s.clipSkip);
    else setClipSkip(undefined);
    if (typeof s.guidance === 'number') setGuidance(s.guidance);
    else setGuidance(undefined);
    if (s.sampler) setSampler(s.sampler);
    if (s.scheduler) setScheduler(s.scheduler);

    const match =
      resolved.aspectPresets.find((p) => p.id === aspectId) ?? resolved.aspectPresets[0];
    if (match) {
      setWidth(match.width);
      setHeight(match.height);
    }
  }, [identityKey, resolved, familyMeta, styleId, aspectId]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const h = await fetchHealth();
        if (!cancelled) {
          setComfyOk(h.comfy);
          setRemoteMode(h.mode === 'remote');
          if (h.comfy) {
            void reloadModels();
            void fetchSystemStats()
              .then((s) => {
                if (!cancelled) setSystemStats(s);
              })
              .catch(() => {
                if (!cancelled) setSystemStats(null);
              });
          } else {
            setSystemStats(null);
          }
        }
      } catch {
        if (!cancelled) {
          setComfyOk(false);
          setSystemStats(null);
        }
      }
    };
    void check();
    const intervalMs = comfyOk === false ? 5_000 : 10_000;
    const id = window.setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [reloadModels, comfyOk]);

  useEffect(() => {
    try {
      localStorage.setItem('darkroom.favorites', JSON.stringify([...favorites]));
    } catch {
      // ignore
    }
  }, [favorites]);

  useEffect(() => {
    let cancelled = false;
    void fetchPreviewSettings()
      .then((info) => {
        if (!cancelled) setPerPromptPreview(info.supportsPerPromptPreview);
      })
      .catch(() => {
        if (!cancelled) setPerPromptPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onComplete = useCallback(
    (record: GenerationRecord) => {
      void reload();
      if (uiSettings.jumpToNewest) {
        setSelectedId(record.id);
        setViewImages(record.images);
      }
      setSettingsOpen(false);
    },
    [reload, uiSettings.jumpToNewest],
  );

  const { runtime, generate, cancel, setLivePreviewEnabled } = useGeneration(onComplete);

  const handleLivePreviewChange = useCallback(
    (enabled: boolean) => {
      setLivePreview(enabled);
      setLivePreviewEnabled(enabled);
    },
    [setLivePreview, setLivePreviewEnabled],
  );

  const handlePreviewQualityChange = useCallback(
    async (quality: 'fast' | 'detailed') => {
      setPreviewQuality(quality);
      try {
        const info = await updatePreviewQuality(quality);
        setPerPromptPreview(info.supportsPerPromptPreview);
      } catch {
        // still keep local preference
      }
    },
    [setPreviewQuality],
  );

  const buildSettings = useCallback(
    (nextSeed: number): GenerationSettings => {
      const s = resolved.settings;
      const base: GenerationSettings = {
        prompt: resolved.finalPositive,
        negative_prompt: resolved.finalNegative,
        checkpoint: modelMode === 'split' ? unet || checkpoint : checkpoint,
        modelMode,
        width,
        height,
        steps,
        cfg: typeof s.cfg === 'number' ? s.cfg : cfg,
        sampler: s.sampler ?? sampler,
        scheduler: s.scheduler ?? scheduler,
        seed: nextSeed,
        batch_size: batchSize,
        clipSkip: s.clipSkip ?? clipSkip,
        guidance: s.guidance ?? guidance,
        loras: loras.length ? loras : undefined,
      };
      if (modelMode === 'split') {
        base.unet = unet;
        base.clipName = clipName;
        base.clipName2 = clipName2 || undefined;
        base.clipType = clipType || 'flux';
        base.vaeName = vaeName;
      } else if (vaeName) {
        base.vaeName = vaeName;
      }
      return base;
    },
    [
      batchSize,
      cfg,
      checkpoint,
      clipName,
      clipName2,
      clipSkip,
      clipType,
      guidance,
      height,
      loras,
      modelMode,
      resolved,
      sampler,
      scheduler,
      steps,
      unet,
      vaeName,
      width,
    ],
  );

  const runGenerate = useCallback(
    async (settings: GenerationSettings) => {
      try {
        await generate(settings, {
          livePreview: uiSettings.livePreview,
          previewMethod:
            perPromptPreview === true
              ? qualityToPreviewMethod(uiSettings.previewQuality)
              : undefined,
        });
      } catch {
        // runtime.error
      }
    },
    [generate, perPromptPreview, uiSettings.livePreview, uiSettings.previewQuality],
  );

  const processQueue = useCallback(async () => {
    if (queueBusy.current) return;
    queueBusy.current = true;
    haltForeverRef.current = false;
    try {
      for (;;) {
        while (queueRef.current.length > 0) {
          if (haltForeverRef.current) {
            setQueue([]);
            queueRef.current = [];
            break;
          }
          const next = queueRef.current[0];
          setActiveQueueId(next.id);
          await runGenerate(next.settings);
          setQueue((q) => {
            const rest = q.filter((j) => j.id !== next.id);
            queueRef.current = rest;
            return rest;
          });
          setActiveQueueId(null);
        }
        if (haltForeverRef.current || !foreverRef.current) break;
        const nextSeed = randomSeed();
        if (!seedLocked) setSeed(nextSeed);
        const settings = buildSettings(nextSeed);
        const job: QueuedJob = {
          id: crypto.randomUUID(),
          settings,
          label: settings.prompt.slice(0, 48) || 'Forever',
        };
        setQueue((q) => {
          const next = [...q, job];
          queueRef.current = next;
          return next;
        });
      }
    } finally {
      queueBusy.current = false;
      setActiveQueueId(null);
    }
  }, [buildSettings, runGenerate, seedLocked]);

  const readiness = useMemo(
    () =>
      evaluateReadiness({
        mode: modelMode,
        checkpoint,
        unet,
        clipName,
        clipName2,
        vaeName,
        catalog,
        family: familyMeta,
        families,
        mapped: resolved.mapped,
      }),
    [
      modelMode,
      checkpoint,
      unet,
      clipName,
      clipName2,
      vaeName,
      catalog,
      familyMeta,
      families,
      resolved.mapped,
    ],
  );

  const generateBlockedReason = useMemo(() => {
    if (comfyOk === false) return 'ComfyUI offline';
    if (readiness.reason) return readiness.reason;
    if (!resolved.finalPositive.trim()) return 'Add a prompt';
    return null;
  }, [comfyOk, readiness.reason, resolved.finalPositive]);

  const openAddModel = useCallback((preferType?: string) => {
    setAddModelPreferType(preferType);
    setAddModelOpen(true);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!readiness.ready || !resolved.finalPositive.trim() || comfyOk === false) {
      return;
    }
    if (queueRef.current.length >= serverSettings.maxQueueLength) {
      setCopyFlash(`Queue full (max ${serverSettings.maxQueueLength})`);
      window.setTimeout(() => setCopyFlash(null), 2000);
      return;
    }
    const nextSeed = seedLocked ? seed : randomSeed();
    if (!seedLocked) setSeed(nextSeed);
    const settings = buildSettings(nextSeed);
    const job: QueuedJob = {
      id: crypto.randomUUID(),
      settings,
      label: settings.prompt.slice(0, 48) || 'Queued job',
    };
    setQueue((q) => {
      const next = [...q, job];
      queueRef.current = next;
      return next;
    });
    void processQueue();
  }, [
    buildSettings,
    comfyOk,
    processQueue,
    readiness.ready,
    resolved.finalPositive,
    seed,
    seedLocked,
    serverSettings.maxQueueLength,
  ]);

  const handleCancel = useCallback(async () => {
    haltForeverRef.current = true;
    setQueue([]);
    queueRef.current = [];
    await cancel();
  }, [cancel]);

  const handleStartComfy = useCallback(async () => {
    setStartingComfy(true);
    try {
      await startComfyApi();
      // health poll will pick it up
    } catch (err) {
      setCopyFlash(err instanceof Error ? err.message : 'Failed to start ComfyUI');
      window.setTimeout(() => setCopyFlash(null), 2500);
    } finally {
      setStartingComfy(false);
    }
  }, []);

  const applyDroppedSettings = useCallback(async (file: File) => {
    const meta = await parseImageSettings(file);
    if (!meta) {
      setCopyFlash('No settings found in image');
      window.setTimeout(() => setCopyFlash(null), 2000);
      return;
    }
    if (meta.prompt) setPrompt(meta.prompt);
    if (meta.negative_prompt != null) setNegativePrompt(meta.negative_prompt);
    if (meta.checkpoint) setCheckpoint(meta.checkpoint);
    if (typeof meta.width === 'number') setWidth(meta.width);
    if (typeof meta.height === 'number') setHeight(meta.height);
    if (typeof meta.steps === 'number') setSteps(meta.steps);
    if (typeof meta.cfg === 'number') setCfg(meta.cfg);
    if (typeof meta.seed === 'number') {
      setSeed(meta.seed);
      setSeedLocked(true);
    }
    if (meta.sampler) setSampler(meta.sampler);
    setAspectId('custom');
    setCopyFlash('Settings loaded from image');
    window.setTimeout(() => setCopyFlash(null), 2000);
  }, []);

  const toggleFavorite = useCallback((item: GenerationRecord) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing =
        tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable;

      const shortcuts = uiSettings.shortcuts;

      if (eventMatchesShortcut(e, shortcuts.generate)) {
        e.preventDefault();
        void handleGenerate();
        return;
      }

      if (typing) return;

      if (eventMatchesShortcut(e, shortcuts.cancel) && runtime.running) {
        e.preventDefault();
        void handleCancel();
        return;
      }

      if (eventMatchesShortcut(e, shortcuts.openSettings)) {
        e.preventDefault();
        setUiSettingsOpen(true);
        return;
      }

      if (
        eventMatchesShortcut(e, shortcuts.prevHistory) ||
        eventMatchesShortcut(e, shortcuts.nextHistory)
      ) {
        if (items.length === 0) return;
        e.preventDefault();
        const idx = items.findIndex((i) => i.id === selectedId);
        const nextIdx = eventMatchesShortcut(e, shortcuts.prevHistory)
          ? idx <= 0
            ? items.length - 1
            : idx - 1
          : idx < 0 || idx >= items.length - 1
            ? 0
            : idx + 1;
        const item = items[nextIdx];
        setSelectedId(item.id);
        setViewImages(item.images);
        return;
      }

      if (eventMatchesShortcut(e, shortcuts.favorite)) {
        const rec = items.find((i) => i.id === selectedId);
        if (rec) {
          e.preventDefault();
          toggleFavorite(rec);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    handleCancel,
    handleGenerate,
    items,
    runtime.running,
    selectedId,
    toggleFavorite,
    uiSettings.shortcuts,
  ]);

  const reuseSettings = (item: GenerationRecord) => {
    const s = item.settings;
    setPrompt(s.prompt);
    setNegativePrompt(s.negative_prompt);
    setModelMode(s.modelMode === 'split' ? 'split' : 'checkpoint');
    setCheckpoint(s.checkpoint);
    setUnet(s.unet ?? '');
    setClipName(s.clipName ?? '');
    setClipName2(s.clipName2 ?? '');
    setClipType(s.clipType ?? 'flux');
    setVaeName(s.vaeName ?? '');
    setLoras(s.loras ?? []);
    setWidth(s.width);
    setHeight(s.height);
    setSteps(s.steps);
    setCfg(s.cfg);
    setClipSkip(s.clipSkip);
    setGuidance(s.guidance);
    setSampler(s.sampler);
    setScheduler(s.scheduler);
    setSeed(s.seed);
    setSeedLocked(true);
    setBatchSize(s.batch_size);
    setDismissedPositive([]);
    setDismissedNegative([]);
    setAdvancedOpen(true);
    setSettingsOpen(true);
  };

  const selectItem = (item: GenerationRecord) => {
    setSelectedId(item.id);
    setViewImages(item.images);
  };

  const selectedRecord = items.find((i) => i.id === selectedId) ?? null;
  const displayImages =
    runtime.running || runtime.resultImages.length > 0 ? runtime.resultImages : viewImages;

  const activeRecord: GenerationRecord | null =
    selectedRecord ??
    (runtime.jobId && displayImages.length > 0
      ? {
          id: runtime.jobId,
          createdAt: Date.now(),
          promptId: runtime.promptId ?? '',
          clientId: '',
          settings: {
            prompt: resolved.finalPositive,
            negative_prompt: resolved.finalNegative,
            checkpoint,
            width,
            height,
            steps,
            cfg,
            sampler,
            scheduler,
            seed,
            batch_size: batchSize,
            clipSkip,
            guidance,
          },
          images: displayImages,
          status: 'completed',
          error: null,
        }
      : null);

  const deleteCurrent = () => {
    if (!activeRecord) return;
    void confirmRemove(activeRecord.id, uiSettings.confirmDelete).then((ok) => {
      if (ok && selectedId === activeRecord.id) {
        setSelectedId(null);
        setViewImages([]);
      }
    });
  };

  const copySeed = async () => {
    const value = String(activeRecord?.settings.seed ?? seed);
    try {
      await navigator.clipboard.writeText(value);
      setCopyFlash('Seed copied');
      window.setTimeout(() => setCopyFlash(null), 1500);
    } catch {
      setCopyFlash('Copy failed');
      window.setTimeout(() => setCopyFlash(null), 1500);
    }
  };

  const historyShared = {
    items,
    selectedId,
    favorites,
    onSelect: selectItem,
    onReuse: reuseSettings,
    onDelete: (item: GenerationRecord) => {
      void confirmRemove(item.id, uiSettings.confirmDelete).then((ok) => {
        if (ok && selectedId === item.id) {
          setSelectedId(null);
          setViewImages([]);
        }
      });
    },
    onToggleFavorite: toggleFavorite,
    loading: histLoading,
  };

  const showMapDialog =
    Boolean(primaryModel) && !resolved.mapped && families.length > 0 && comfyOk !== false;

  const renderSettings = () => (
    <SettingsPanel
      footer={
        <div className="space-y-2">
          <JobQueue
            jobs={queue}
            activeId={activeQueueId}
            onRemove={(id) => setQueue((q) => q.filter((j) => j.id !== id))}
            onReorder={(from, to) => {
              setQueue((q) => {
                const next = [...q];
                const [item] = next.splice(from, 1);
                next.splice(to, 0, item);
                return next;
              });
            }}
          />
          <GenerateButton
            onGenerate={() => void handleGenerate()}
            onCancel={() => void handleCancel()}
            running={runtime.running}
            progress={runtime.progress}
            progressStep={runtime.progressStep}
            progressMax={runtime.progressMax}
            disabled={Boolean(generateBlockedReason) || !readiness.ready}
            disabledReason={generateBlockedReason}
          />
          {runtime.error && <p className="text-xs text-destructive">{runtime.error}</p>}
        </div>
      }
    >
      <PanelSection title="Model">
        <ModelStackPanel
          catalog={catalog}
          mode={modelMode}
          onModeChange={(mode) => {
            setModelMode(mode);
            setStyleId(null);
            setDismissedPositive([]);
            setDismissedNegative([]);
            prevFamily.current = null;
          }}
          checkpoint={checkpoint}
          onCheckpointChange={(v) => {
            setCheckpoint(v);
            setStyleId(null);
            setDismissedPositive([]);
            setDismissedNegative([]);
            prevFamily.current = null;
          }}
          unet={unet}
          onUnetChange={(v) => {
            setUnet(v);
            lastAutopickUnet.current = '';
            setStyleId(null);
            setDismissedPositive([]);
            setDismissedNegative([]);
            prevFamily.current = null;
          }}
          clipName={clipName}
          onClipNameChange={setClipName}
          clipName2={clipName2}
          onClipName2Change={setClipName2}
          clipType={clipType}
          onClipTypeChange={setClipType}
          vaeName={vaeName}
          onVaeNameChange={setVaeName}
          loading={modelsLoading}
          offline={comfyOk === false}
          familyName={resolved.familyName}
          mapped={resolved.mapped}
          disabled={runtime.running}
          missing={readiness.missing}
          needsGguf={readiness.needsGguf}
          offerGguf={
            Boolean(familyMeta?.supportsGguf) &&
            !catalog.available.ggufUnet &&
            !readiness.needsGguf
          }
          onAddModel={openAddModel}
        />
        <LoraPanel
          loras={loras}
          options={catalog.loras}
          onChange={setLoras}
          loading={modelsLoading}
          disabled={runtime.running}
          offline={comfyOk === false}
          onAddModel={() => openAddModel('lora')}
        />
        {catalog.embeddings.length > 0 ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Embeddings ({catalog.embeddings.length}): type{' '}
            <code className="text-[10px]">embedding:name</code> in the prompt. Available:{' '}
            {catalog.embeddings.slice(0, 8).join(', ')}
            {catalog.embeddings.length > 8 ? '…' : ''}
          </p>
        ) : null}
        <StyleSelect
          styles={styles}
          value={styleId ?? resolved.styleId}
          onChange={(id) => {
            setStyleId(id);
            setDismissedPositive([]);
            setDismissedNegative([]);
          }}
          disabled={runtime.running || !resolved.mapped}
          visible={Boolean(resolved.familyId)}
        />
      </PanelSection>

      <PanelSection title="Prompt">
        <PromptPanel
          prompt={prompt}
          negativePrompt={negativePrompt}
          positiveTags={resolved.positiveTags}
          negativeTags={resolved.negativeTags}
          disableNegative={resolved.disableNegative}
          familyId={resolved.familyId}
          tagsEnabled={resolved.tagsEnabled}
          finalPositive={resolved.finalPositive}
          finalNegative={resolved.finalNegative}
          onPromptChange={setPrompt}
          onNegativeChange={setNegativePrompt}
          onDismissPositive={(tag) =>
            setDismissedPositive((prev) => (prev.includes(tag) ? prev : [...prev, tag]))
          }
          onDismissNegative={(tag) =>
            setDismissedNegative((prev) => (prev.includes(tag) ? prev : [...prev, tag]))
          }
          disabled={runtime.running}
        />
        <FinalPromptPreview
          open={finalOpen}
          onOpenChange={setFinalOpen}
          positive={resolved.finalPositive}
          negative={resolved.finalNegative}
          cfg={resolved.settings.cfg ?? cfg}
          clipSkip={resolved.settings.clipSkip ?? clipSkip}
          sampler={resolved.settings.sampler ?? sampler}
          checkpoint={primaryModel}
        />
      </PanelSection>

      <PanelSection title="Image">
        <AspectRatioPresets
          presets={resolved.aspectPresets}
          width={width}
          height={height}
          aspectId={aspectId}
          onChange={(w, h, id) => {
            setWidth(w);
            setHeight(h);
            setAspectId(id);
          }}
          disabled={runtime.running}
        />
        <SeedControl
          seed={seed}
          locked={seedLocked}
          onSeedChange={setSeed}
          onLockedChange={setSeedLocked}
          disabled={runtime.running}
        />
        <BatchControl
          batchSize={batchSize}
          onBatchChange={setBatchSize}
          disabled={runtime.running}
        />
      </PanelSection>

      <PanelSection title="Advanced">
        <AdvancedSettings open={advancedOpen} onOpenChange={setAdvancedOpen} asSection>
          <SamplerControls
            steps={steps}
            cfg={cfg}
            sampler={sampler}
            scheduler={scheduler}
            onStepsChange={setSteps}
            onCfgChange={setCfg}
            onSamplerChange={setSampler}
            onSchedulerChange={setScheduler}
            disabled={runtime.running}
          />
        </AdvancedSettings>
      </PanelSection>
    </SettingsPanel>
  );

  return (
    <>
      <AppShell
        comfyOk={comfyOk}
        controlsDimmed={comfyOk === false}
        historyPosition={uiSettings.historyPosition}
        resizablePanels={uiSettings.resizablePanels}
        systemLabel={systemStats?.ok ? systemStats.label : null}
        vramTooltip={systemStats?.vramTooltip}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
        uiSettingsOpen={uiSettingsOpen}
        onUiSettingsOpenChange={setUiSettingsOpen}
        settings={renderSettings()}
        settingsDrawer={renderSettings()}
        uiSettings={
          <AppSettingsPanel
            ui={uiSettings}
            onUiPatch={updateUiSettings}
            onLivePreviewChange={handleLivePreviewChange}
            onPreviewQualityChange={(q) => void handlePreviewQualityChange(q)}
            perPromptPreview={perPromptPreview}
            server={serverSettings}
            serverHints={serverHints}
            diskUsage={diskUsage}
            serverLoading={serverSettingsLoading}
            onServerPatch={(p) => patchServerSettings(p)}
            onCopyDiagnostics={async () => {
              await copyDiagnostics();
            }}
            onBackupNow={async () => {
              await backupNow();
            }}
          />
        }
        stage={
          <MainStage>
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-hidden">
                <PreviewCanvas
                  previewUrl={runtime.previewUrl}
                  resultImages={displayImages}
                  running={runtime.running}
                  width={width}
                  height={height}
                  progressStep={runtime.progressStep}
                  progressMax={runtime.progressMax}
                  offline={comfyOk === false}
                  remoteMode={remoteMode}
                  onStartComfy={() => void handleStartComfy()}
                  startingComfy={startingComfy}
                  onDropSettingsFile={(file) => void applyDroppedSettings(file)}
                  canvasBackground={uiSettings.canvasBackground}
                  emptyModelState={readiness.nothingInstalled}
                  onAddModel={() => openAddModel()}
                />
              </div>
              <div className="mt-4 shrink-0 space-y-2">
                <ResultActionBar
                  record={activeRecord}
                  images={displayImages}
                  visible={!runtime.running && displayImages.length > 0}
                  onReuse={() => {
                    if (activeRecord) reuseSettings(activeRecord);
                  }}
                  onDelete={deleteCurrent}
                  onCopySeed={() => void copySeed()}
                />
                {copyFlash && (
                  <p className="text-center text-[11px] text-muted-foreground">{copyFlash}</p>
                )}
              </div>
            </div>
          </MainStage>
        }
        history={<Gallery {...historyShared} orientation="vertical" />}
        historyMobile={<Gallery {...historyShared} orientation="horizontal" />}
      />
      <MapFamilyDialog
        open={showMapDialog}
        checkpoint={primaryModel}
        families={
          /\.gguf$/i.test(primaryModel)
            ? families.filter((f) => f.supportsGguf || f.id === 'flux' || f.id === 'sd3')
            : families
        }
        onSave={async (family) => {
          await mapCheckpointFamily(primaryModel, family);
          prevFamily.current = null;
          setStyleId(null);
          setDismissedPositive([]);
          setDismissedNegative([]);
          const next = await resolvePresetsApi({
            checkpoint: primaryModel,
            styleId: null,
            dismissedPositive: [],
            dismissedNegative: [],
            userPositive: prompt,
            userNegative: negativePrompt,
          });
          setResolved(next);
          if (next.styleId) setStyleId(next.styleId);
          // Offer GGUF component hint for transformer families
          if ((family === 'flux' || family === 'sd3') && !catalog.available.ggufUnet) {
            setCopyFlash('Tip: install ComfyUI-GGUF from the CLI for .gguf models');
            window.setTimeout(() => setCopyFlash(null), 4000);
          }
          const fam = families.find((f) => f.id === family);
          if (fam?.dependencies?.length) {
            setDepFamilyId(family);
          }
        }}
      />
      {depFamilyId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-xl">
            <DependencyResolver
              familyId={depFamilyId}
              vramTotalBytes={systemStats?.vramTotal}
              onDone={() => {
                setDepFamilyId(null);
                void reloadModels();
              }}
              onSkip={() => setDepFamilyId(null)}
            />
          </div>
        </div>
      ) : null}
      <AddModelDialog
        open={addModelOpen}
        onClose={() => setAddModelOpen(false)}
        preferType={addModelPreferType}
        families={families}
        onInstalled={({ filename, type, family }) => {
          void reloadModels().then(() => {
            if (type === 'checkpoint') {
              setModelMode('checkpoint');
              setCheckpoint(filename);
            } else if (type === 'diffusion') {
              setModelMode('split');
              setUnet(filename);
              lastAutopickUnet.current = '';
            } else if (type === 'text_encoder') {
              setModelMode('split');
              if (!clipName) setClipName(filename);
              else if (!clipName2) setClipName2(filename);
            } else if (type === 'vae') {
              setVaeName(filename);
            }
            if (family) {
              void mapCheckpointFamily(filename, family).then(async () => {
                const next = await resolvePresetsApi({
                  checkpoint: filename,
                  styleId: null,
                  dismissedPositive: [],
                  dismissedNegative: [],
                  userPositive: prompt,
                  userNegative: negativePrompt,
                });
                setResolved(next);
              });
            }
          });
        }}
      />
    </>
  );
}
