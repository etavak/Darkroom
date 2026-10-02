import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddModelDialog } from '@/components/controls/AddModelDialog';
import { AspectRatioPresets } from '@/components/controls/AspectRatioPresets';
import { BatchControl } from '@/components/controls/BatchControl';
import { CollapsibleSection } from '@/components/controls/CollapsibleSection';
import { FinalPromptPreview } from '@/components/controls/FinalPromptPreview';
import { GenerateButton } from '@/components/controls/GenerateButton';
import { HiresFixControls } from '@/components/controls/HiresFixControls';
import {
  ControlNetPanel,
  DEFAULT_CONTROLNET_UI,
  controlNetPayload,
  type ControlNetUiState,
} from '@/components/controls/ControlNetPanel';
import {
  DEFAULT_DETAILER,
  DetailerControls,
} from '@/components/controls/DetailerControls';
import { JobQueue, type QueuedJob } from '@/components/controls/JobQueue';
import { LoraPanel } from '@/components/controls/LoraPanel';
import { DependencyResolver } from '@/components/controls/DependencyResolver';
import { MapFamilyDialog } from '@/components/controls/MapFamilyDialog';
import { ModelStackPanel } from '@/components/controls/ModelStackPanel';
import { PromptPanel } from '@/components/controls/PromptPanel';
import { SamplerControls } from '@/components/controls/SamplerControls';
import { SeedControl } from '@/components/controls/SeedControl';
import { SourcePanel } from '@/components/controls/SourcePanel';
import { StyleSelect } from '@/components/controls/StyleSelect';
import { Gallery } from '@/components/gallery/Gallery';
import { AppShell } from '@/components/layout/AppShell';
import { MainStage } from '@/components/layout/MainStage';
import { SettingsPanel } from '@/components/layout/SettingsPanel';
import { PreviewCanvas } from '@/components/preview/PreviewCanvas';
import {
  ResultActionBar,
  type UpscaleRequest,
  type VaryStrength,
} from '@/components/preview/ResultActionBar';
import { AppSettingsPanel } from '@/components/settings/AppSettingsPanel';
import { UndoToast } from '@/components/ui/UndoToast';
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
import { shortModelName } from '@/lib/modelProfiles';
import {
  autoPickStack,
  evaluateReadiness,
  inferFamilyFromDiffusion,
} from '@/lib/modelReadiness';
import {
  loadPanelSections,
  savePanelSections,
  type PanelSectionId,
  type PanelSectionState,
} from '@/lib/panelSections';
import { pushRecentPrompt } from '@/lib/promptLibrary';
import {
  matchSourceSize,
  uploadFileAsSource,
  useGalleryAsSource,
} from '@/lib/sourceImage';
import { eventMatchesShortcut, qualityToPreviewMethod } from '@/lib/uiSettings';
import type {
  ControlNetSettings,
  DetailerSettings,
  GenerationRecord,
  GenerationSettings,
  HiresFixSettings,
  LoraSettings,
  ModelLoadMode,
  OutpaintSettings,
  SourceFitMode,
  SourceImageState,
  SourceSizeMode,
  SystemStatsSummary,
  WorkMode,
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
  const {
    items,
    loading: histLoading,
    reload,
    softDelete,
    undoDelete,
    dismissUndo,
    pendingDelete,
  } = useHistory();
  const [comfyOk, setComfyOk] = useState<boolean | null>(null);
  const [remoteMode, setRemoteMode] = useState(false);
  const [startingComfy, setStartingComfy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uiSettingsOpen, setUiSettingsOpen] = useState(false);
  const [finalOpen, setFinalOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState<PanelSectionState>(() => loadPanelSections());
  const modelAutoCollapsed = useRef(false);
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
  /** Keep queueRef in sync — never assign queueRef from render (races the async drain loop). */
  const syncQueue = useCallback((next: QueuedJob[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

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

  useEffect(() => {
    if (detailerDefaultApplied.current || serverSettingsLoading) return;
    detailerDefaultApplied.current = true;
    if (serverSettings.detailerDefault) {
      setDetailer((prev) => ({ ...prev, enabled: true }));
    }
  }, [serverSettings.detailerDefault, serverSettingsLoading]);

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
  const [clipTypeOverride, setClipTypeOverride] = useState(false);
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
  const [hiresFix, setHiresFix] = useState<HiresFixSettings>({
    enabled: false,
    scale: 1.5,
    steps: 15,
    denoise: 0.45,
  });
  const [controlNet, setControlNet] = useState<ControlNetUiState>(DEFAULT_CONTROLNET_UI);
  const [detailer, setDetailer] = useState<DetailerSettings>(DEFAULT_DETAILER);
  const detailerDefaultApplied = useRef(false);
  const [source, setSource] = useState<SourceImageState | null>(null);
  const [workMode, setWorkMode] = useState<WorkMode>('generate');
  const [imgDenoise, setImgDenoise] = useState(0.55);
  const [sourceSizeMode, setSourceSizeMode] = useState<SourceSizeMode>('match');
  const [sourceFit, setSourceFit] = useState<SourceFitMode>('crop');
  const [outpaint, setOutpaint] = useState<OutpaintSettings>({
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    feather: 40,
    targetAspect: null,
  });
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

  const sizeMultiple =
    familyMeta?.sizeMultiple ?? (familyMeta?.loaderKind === 'transformer' ? 64 : 8);

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
    if (picked.clipType && !clipTypeOverride) setClipType(picked.clipType);
  }, [modelMode, unet, familyMeta, catalog, families, clipTypeOverride]);

  // Keep clip type aligned with family unless the user overrides
  useEffect(() => {
    if (clipTypeOverride) return;
    const auto = familyMeta?.defaultClipType;
    if (auto) setClipType(auto);
  }, [familyMeta?.defaultClipType, familyMeta?.id, clipTypeOverride]);

  useEffect(() => {
    savePanelSections(panelOpen);
  }, [panelOpen]);

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
    if (typeof s.steps === 'number') setSteps(s.steps);
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
      if (uiSettings.jumpToNewest || !selectedId) {
        setSelectedId(record.id);
        setViewImages(record.images);
      }
      setSettingsOpen(false);
    },
    [reload, selectedId, uiSettings.jumpToNewest],
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
      let w = width;
      let h = height;
      if (workMode === 'img2img' && source && sourceSizeMode === 'match' && source.width && source.height) {
        const matched = matchSourceSize(source.width, source.height, sizeMultiple);
        w = matched.width;
        h = matched.height;
      }

      const generationMode =
        workMode === 'generate'
          ? 'txt2img'
          : workMode === 'img2img'
            ? 'img2img'
            : workMode === 'outpaint'
              ? 'outpaint'
              : 'edit';

      const base: GenerationSettings = {
        prompt: resolved.finalPositive,
        negative_prompt: resolved.finalNegative,
        checkpoint: modelMode === 'split' ? unet || checkpoint : checkpoint,
        modelMode,
        width: w,
        height: h,
        steps,
        cfg,
        sampler,
        scheduler,
        seed: nextSeed,
        batch_size: batchSize,
        clipSkip,
        guidance,
        loras: loras.length ? loras : undefined,
        hiresFix: hiresFix.enabled && workMode === 'generate' ? hiresFix : undefined,
        controlnet: controlNetPayload(controlNet) ?? undefined,
        detailer: detailer.enabled ? detailer : undefined,
        generationMode,
        sourceImage: workMode === 'generate' ? undefined : source?.comfyName,
        parentId: workMode === 'generate' ? undefined : source?.parentId || undefined,
        denoise: workMode === 'generate' ? undefined : imgDenoise,
        sourceSizeMode,
        sourceFit,
        sizeMultiple,
        outpaint: workMode === 'outpaint' ? outpaint : undefined,
        editStrategy:
          workMode === 'edit' ? familyMeta?.editStrategy ?? 'kontext' : undefined,
        inpaintModel: familyMeta?.preferredInpaintModel,
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
      controlNet,
      detailer,
      familyMeta?.editStrategy,
      familyMeta?.preferredInpaintModel,
      guidance,
      height,
      hiresFix,
      imgDenoise,
      loras,
      modelMode,
      outpaint,
      resolved,
      sampler,
      scheduler,
      sizeMultiple,
      source,
      sourceFit,
      sourceSizeMode,
      steps,
      unet,
      workMode,
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
            syncQueue([]);
            break;
          }
          const next = queueRef.current[0];
          setActiveQueueId(next.id);
          await runGenerate(next.settings);
          syncQueue(queueRef.current.filter((j) => j.id !== next.id));
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
        syncQueue([...queueRef.current, job]);
      }
    } finally {
      queueBusy.current = false;
      setActiveQueueId(null);
      // Jobs may have been enqueued while this drain was finishing
      if (queueRef.current.length > 0 && !haltForeverRef.current) {
        queueMicrotask(() => {
          void processQueue();
        });
      }
    }
  }, [buildSettings, runGenerate, seedLocked, syncQueue]);

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
    if (workMode !== 'generate' && !source) return 'Set a source image';
    if (!resolved.finalPositive.trim()) {
      return workMode === 'edit' ? 'Describe the change' : 'Add a prompt';
    }
    return null;
  }, [comfyOk, readiness.reason, resolved.finalPositive, source, workMode]);

  // Collapse Model once the stack is valid (first time only)
  useEffect(() => {
    if (!readiness.ready || modelAutoCollapsed.current) return;
    modelAutoCollapsed.current = true;
    setPanelOpen((prev) => ({ ...prev, model: false, prompt: true }));
  }, [readiness.ready]);

  const setSectionOpen = useCallback((id: PanelSectionId, open: boolean) => {
    setPanelOpen((prev) => ({ ...prev, [id]: open }));
  }, []);

  const soloSection = useCallback((id: PanelSectionId) => {
    setPanelOpen({
      model: id === 'model',
      source: id === 'source',
      prompt: id === 'prompt',
      image: id === 'image',
      loras: id === 'loras',
      sampling: id === 'sampling',
    });
  }, []);

  const applySource = useCallback(
    (next: SourceImageState, preferMode: WorkMode = 'img2img') => {
      setSource(next);
      setWorkMode((prev) => (prev === 'generate' ? preferMode : prev));
      setPanelOpen((p) => ({ ...p, source: true }));
      if (next.width > 0 && next.height > 0) {
        const matched = matchSourceSize(next.width, next.height, sizeMultiple);
        if (sourceSizeMode === 'match') {
          setWidth(matched.width);
          setHeight(matched.height);
          setAspectId('custom');
        }
      }
    },
    [sizeMultiple, sourceSizeMode],
  );

  const clearSource = useCallback(() => {
    setSource(null);
    setWorkMode('generate');
  }, []);

  const setSourceFromFile = useCallback(
    async (file: File) => {
      try {
        const next = await uploadFileAsSource(file);
        applySource(next, 'img2img');
      } catch (err) {
        setCopyFlash(err instanceof Error ? err.message : 'Source upload failed');
        window.setTimeout(() => setCopyFlash(null), 2500);
      }
    },
    [applySource],
  );

  const setSourceFromGallery = useCallback(
    async (item: GenerationRecord) => {
      if (!item.images[0]) return;
      try {
        const next = await useGalleryAsSource(item.images[0], item.id);
        applySource(next, 'img2img');
      } catch (err) {
        setCopyFlash(err instanceof Error ? err.message : 'Source upload failed');
        window.setTimeout(() => setCopyFlash(null), 2500);
      }
    },
    [applySource],
  );

  const stackFamily =
    familyMeta ??
    (modelMode === 'split' ? inferFamilyFromDiffusion(unet, families) : null);
  const teCount = stackFamily?.requiredComponents?.text_encoders?.length ?? 0;
  const teHints = stackFamily?.filenameHints ?? {};
  const teKeys = stackFamily?.requiredComponents?.text_encoders ?? [];
  const vaeKeys = stackFamily?.requiredComponents?.vae ?? [];

  const modelSummary = useMemo(() => {
    if (modelMode === 'split') {
      return [shortModelName(unet), shortModelName(clipName), shortModelName(vaeName)]
        .filter((x) => x && x !== '—')
        .join(' · ');
    }
    return shortModelName(checkpoint);
  }, [modelMode, unet, clipName, vaeName, checkpoint]);

  const promptSummary = useMemo(() => {
    const t = resolved.finalPositive.trim() || prompt.trim();
    if (!t) return 'Empty prompt';
    return t.length > 42 ? `${t.slice(0, 40)}…` : t;
  }, [resolved.finalPositive, prompt]);

  const imageSummary = `${width}×${height} · seed ${seed}${seedLocked ? ' · locked' : ''}${
    hiresFix.enabled ? ` · hires ${hiresFix.scale}×` : ''
  }${controlNet.enabled && controlNet.name ? ' · CN' : ''}${
    detailer.enabled ? ' · detailer' : ''
  }`;
  const loraSummary =
    loras.length === 0
      ? 'None'
      : loras.map((l) => `${shortModelName(l.name)} ${l.strength_model}`).join(', ');
  const samplingSummary = `${steps} steps · CFG ${cfg} · ${sampler}`;

  const previousImage = useMemo(() => {
    const completed = items.filter((i) => i.images[0]);
    if (selectedId) {
      const idx = completed.findIndex((i) => i.id === selectedId);
      if (idx >= 0 && completed[idx + 1]?.images[0]) return completed[idx + 1].images[0];
    }
    if (runtime.resultImages[0] && completed[0]?.images[0] !== runtime.resultImages[0]) {
      return completed[0]?.images[0] ?? null;
    }
    return completed[1]?.images[0] ?? null;
  }, [items, selectedId, runtime.resultImages]);

  const openAddModel = useCallback((preferType?: string) => {
    setAddModelPreferType(preferType);
    setAddModelOpen(true);
  }, []);

  // Show the most recent history image on the canvas once history loads
  const historySeeded = useRef(false);
  useEffect(() => {
    if (historySeeded.current || histLoading) return;
    historySeeded.current = true;
    if (selectedId || viewImages.length > 0) return;
    const first = items.find((i) => i.status === 'completed' && i.images[0]);
    if (first) {
      setSelectedId(first.id);
      setViewImages(first.images);
    }
  }, [histLoading, items, selectedId, viewImages.length]);

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
    if (prompt.trim()) pushRecentPrompt(prompt);
    const job: QueuedJob = {
      id: crypto.randomUUID(),
      settings,
      label: settings.prompt.slice(0, 48) || 'Queued job',
    };
    syncQueue([...queueRef.current, job]);
    void processQueue();
  }, [
    buildSettings,
    comfyOk,
    processQueue,
    prompt,
    readiness.ready,
    resolved.finalPositive,
    seed,
    seedLocked,
    serverSettings.maxQueueLength,
    syncQueue,
  ]);

  const handleCancel = useCallback(async () => {
    haltForeverRef.current = true;
    syncQueue([]);
    await cancel();
  }, [cancel, syncQueue]);

  /** Cancel one queue job; if it's running, interrupt without clearing the rest. */
  const cancelQueueJob = useCallback(
    async (id: string) => {
      if (id === activeQueueId) {
        await cancel();
        syncQueue(queueRef.current.filter((j) => j.id !== id));
        return;
      }
      syncQueue(queueRef.current.filter((j) => j.id !== id));
    },
    [activeQueueId, cancel, syncQueue],
  );

  const enqueueJob = useCallback(
    (settings: GenerationSettings, label?: string) => {
      if (comfyOk === false) return;
      if (queueRef.current.length >= serverSettings.maxQueueLength) {
        setCopyFlash(`Queue full (max ${serverSettings.maxQueueLength})`);
        window.setTimeout(() => setCopyFlash(null), 2000);
        return;
      }
      const job: QueuedJob = {
        id: crypto.randomUUID(),
        settings,
        label: label || settings.prompt.slice(0, 48) || 'Queued job',
      };
      syncQueue([...queueRef.current, job]);
      void processQueue();
    },
    [comfyOk, processQueue, serverSettings.maxQueueLength, syncQueue],
  );

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
    const s = meta.settings;
    if (meta.prompt) setPrompt(meta.prompt);
    if (meta.negative_prompt != null) setNegativePrompt(meta.negative_prompt);
    if (meta.checkpoint) {
      if (s && s.modelMode === 'split') {
        setModelMode('split');
        if (typeof s.unet === 'string') setUnet(s.unet);
        if (typeof s.clipName === 'string') setClipName(s.clipName);
        if (typeof s.clipName2 === 'string') setClipName2(s.clipName2);
        if (typeof s.clipType === 'string') setClipType(s.clipType);
        if (typeof s.vaeName === 'string') setVaeName(s.vaeName);
      } else {
        setModelMode('checkpoint');
        setCheckpoint(meta.checkpoint);
      }
    }
    if (typeof meta.width === 'number') setWidth(meta.width);
    if (typeof meta.height === 'number') setHeight(meta.height);
    if (typeof meta.steps === 'number') setSteps(meta.steps);
    if (typeof meta.cfg === 'number') setCfg(meta.cfg);
    if (typeof meta.seed === 'number') {
      setSeed(meta.seed);
      setSeedLocked(true);
    }
    if (meta.sampler) setSampler(meta.sampler);
    if (meta.scheduler) setScheduler(meta.scheduler);
    if (typeof meta.clipSkip === 'number') setClipSkip(meta.clipSkip);
    if (typeof meta.guidance === 'number') setGuidance(meta.guidance);
    if (s?.hiresFix && typeof s.hiresFix === 'object') {
      const hf = s.hiresFix as HiresFixSettings;
      setHiresFix({
        enabled: Boolean(hf.enabled),
        scale: typeof hf.scale === 'number' ? hf.scale : 1.5,
        steps: typeof hf.steps === 'number' ? hf.steps : 15,
        denoise: typeof hf.denoise === 'number' ? hf.denoise : 0.45,
        sampler: hf.sampler,
        scheduler: hf.scheduler,
      });
    }
    if (s?.controlnet && typeof s.controlnet === 'object') {
      const cn = s.controlnet as ControlNetSettings;
      setControlNet({
        enabled: Boolean(cn.name && cn.image),
        name: typeof cn.name === 'string' ? cn.name : '',
        image: typeof cn.image === 'string' ? cn.image : '',
        previewUrl: null,
        strength: typeof cn.strength === 'number' ? cn.strength : 1,
        start_percent: typeof cn.start_percent === 'number' ? cn.start_percent : 0,
        end_percent: typeof cn.end_percent === 'number' ? cn.end_percent : 1,
        preprocessor: cn.preprocessor === 'canny' || cn.preprocessor === 'depth' || cn.preprocessor === 'openpose'
          ? cn.preprocessor
          : 'none',
      });
    }
    if (s?.detailer && typeof s.detailer === 'object') {
      const d = s.detailer as DetailerSettings;
      setDetailer({
        enabled: Boolean(d.enabled),
        guide_size: typeof d.guide_size === 'number' ? d.guide_size : 512,
        steps: typeof d.steps === 'number' ? d.steps : 12,
        denoise: typeof d.denoise === 'number' ? d.denoise : 0.4,
        detector: typeof d.detector === 'string' ? d.detector : 'bbox/face_yolov8m.pt',
      });
    }
    if (Array.isArray(s?.loras)) {
      setLoras(
        s.loras.filter(
          (l): l is LoraSettings =>
            Boolean(l) && typeof l === 'object' && typeof (l as LoraSettings).name === 'string',
        ) as LoraSettings[],
      );
    }
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
    const onPaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing =
        tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable;
      if (typing) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void setSourceFromFile(file);
          }
          break;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [setSourceFromFile]);

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
    setClipTypeOverride(Boolean(s.clipType));
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
    if (s.hiresFix) {
      setHiresFix({
        enabled: Boolean(s.hiresFix.enabled),
        scale: s.hiresFix.scale ?? 1.5,
        steps: s.hiresFix.steps ?? 15,
        denoise: s.hiresFix.denoise ?? 0.45,
        sampler: s.hiresFix.sampler,
        scheduler: s.hiresFix.scheduler,
      });
    }
    if (s.controlnet) {
      setControlNet({
        enabled: Boolean(s.controlnet.name && s.controlnet.image),
        name: s.controlnet.name,
        image: s.controlnet.image,
        previewUrl: null,
        strength: s.controlnet.strength ?? 1,
        start_percent: s.controlnet.start_percent ?? 0,
        end_percent: s.controlnet.end_percent ?? 1,
        preprocessor:
          s.controlnet.preprocessor === 'canny' ||
          s.controlnet.preprocessor === 'depth' ||
          s.controlnet.preprocessor === 'openpose'
            ? s.controlnet.preprocessor
            : 'none',
      });
    } else {
      setControlNet(DEFAULT_CONTROLNET_UI);
    }
    if (s.detailer) {
      setDetailer({
        enabled: Boolean(s.detailer.enabled),
        guide_size: s.detailer.guide_size ?? 512,
        steps: s.detailer.steps ?? 12,
        denoise: s.detailer.denoise ?? 0.4,
        detector: s.detailer.detector ?? 'bbox/face_yolov8m.pt',
      });
    } else {
      setDetailer(DEFAULT_DETAILER);
    }
    setDismissedPositive([]);
    setDismissedNegative([]);
    setPanelOpen((prev) => ({ ...prev, sampling: true, model: true, image: true }));
    setSettingsOpen(true);
  };

  const selectItem = (item: GenerationRecord) => {
    setSelectedId(item.id);
    setViewImages(item.images);
  };

  const selectedRecord = items.find((i) => i.id === selectedId) ?? null;
  /** Prefer history selection when idle so delete/navigation update the canvas. */
  const displayImages = runtime.running ? runtime.resultImages : viewImages;

  const selectNeighborAfterDelete = useCallback(
    (deletedId: string, remaining: GenerationRecord[]) => {
      if (selectedId !== deletedId) return;
      const next = remaining.find((i) => i.status === 'completed' && i.images[0]);
      if (next) {
        setSelectedId(next.id);
        setViewImages(next.images);
      } else {
        setSelectedId(null);
        setViewImages([]);
      }
    },
    [selectedId],
  );

  const deleteHistoryItem = useCallback(
    (item: GenerationRecord) => {
      const remaining = items.filter((i) => i.id !== item.id);
      softDelete(item);
      selectNeighborAfterDelete(item.id, remaining);
    },
    [items, selectNeighborAfterDelete, softDelete],
  );

  const deleteCurrent = () => {
    if (!selectedRecord || selectedRecord.status !== 'completed') return;
    deleteHistoryItem(selectedRecord);
  };

  const handleVary = useCallback(
    (strength: VaryStrength) => {
      if (!selectedRecord?.images[0] || !readiness.ready) return;
      const denoise = strength === 'subtle' ? 0.3 : 0.6;
      const nextSeed = randomSeed();
      const base = buildSettings(nextSeed);
      enqueueJob(
        {
          ...base,
          prompt: selectedRecord.settings.prompt || base.prompt,
          negative_prompt: selectedRecord.settings.negative_prompt ?? base.negative_prompt,
          width: selectedRecord.settings.width,
          height: selectedRecord.settings.height,
          seed: nextSeed,
          generationMode: 'img2img',
          sourceImage: selectedRecord.images[0],
          parentId: selectedRecord.id,
          denoise,
          hiresFix: undefined,
          upscale: undefined,
        },
        `Vary ${strength}`,
      );
    },
    [buildSettings, enqueueJob, readiness.ready, selectedRecord],
  );

  const handleUpscale = useCallback(
    (req: UpscaleRequest) => {
      if (!selectedRecord?.images[0] || !readiness.ready) return;
      const nextSeed = randomSeed();
      const base = buildSettings(nextSeed);
      enqueueJob(
        {
          ...base,
          prompt: selectedRecord.settings.prompt || base.prompt,
          negative_prompt: selectedRecord.settings.negative_prompt ?? base.negative_prompt,
          width: selectedRecord.settings.width,
          height: selectedRecord.settings.height,
          seed: nextSeed,
          generationMode: 'upscale',
          sourceImage: selectedRecord.images[0],
          parentId: selectedRecord.id,
          hiresFix: undefined,
          upscale: {
            enabled: true,
            model: req.model,
            scale: req.scale,
            refine: req.refine,
            refineDenoise: 0.25,
            refineSteps: 12,
          },
        },
        `Upscale ${req.scale}×`,
      );
    },
    [buildSettings, enqueueJob, readiness.ready, selectedRecord],
  );

  const copySeed = async () => {
    const value = String(selectedRecord?.settings.seed ?? seed);
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
    onDelete: deleteHistoryItem,
    onToggleFavorite: toggleFavorite,
    onUseAsSource: (item: GenerationRecord) => {
      void setSourceFromGallery(item);
    },
    onViewSource: (parentId: string) => {
      const parent = items.find((i) => i.id === parentId);
      if (parent) selectItem(parent);
    },
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
            onRemove={(id) => {
              void cancelQueueJob(id);
            }}
            onReorder={(from, to) => {
              const next = [...queueRef.current];
              const [item] = next.splice(from, 1);
              if (!item) return;
              next.splice(to, 0, item);
              syncQueue(next);
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
            queueCount={queue.length}
          />
          {runtime.error && <p className="text-xs text-destructive">{runtime.error}</p>}
        </div>
      }
    >
      <CollapsibleSection
        id="model"
        title="Model"
        open={panelOpen.model}
        onOpenChange={(o) => setSectionOpen('model', o)}
        onSolo={() => soloSection('model')}
        summary={modelSummary}
      >
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
          clipTypeOverride={clipTypeOverride}
          onClipTypeOverrideChange={setClipTypeOverride}
          vaeName={vaeName}
          onVaeNameChange={setVaeName}
          loras={loras}
          onLorasChange={setLoras}
          loading={modelsLoading}
          offline={comfyOk === false}
          familyName={resolved.familyName}
          mapped={resolved.mapped}
          textEncoderCount={teCount || (modelMode === 'split' ? 1 : 0)}
          te1Hint={teKeys[0] ? `Hint: ${(teHints[teKeys[0]] || []).join(', ') || teKeys[0]}` : null}
          te2Hint={teKeys[1] ? `Hint: ${(teHints[teKeys[1]] || []).join(', ') || teKeys[1]}` : null}
          vaeHint={vaeKeys[0] ? `Hint: ${(teHints[vaeKeys[0]] || []).join(', ') || 'models/vae'}` : null}
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
        {catalog.embeddings.length > 0 ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Embeddings: type <code className="text-[10px]">embedding:name</code> —{' '}
            {catalog.embeddings.slice(0, 6).join(', ')}
            {catalog.embeddings.length > 6 ? '…' : ''}
          </p>
        ) : null}
      </CollapsibleSection>

      <CollapsibleSection
        id="source"
        title="Source"
        open={panelOpen.source}
        onOpenChange={(o) => setSectionOpen('source', o)}
        onSolo={() => soloSection('source')}
        summary={
          source
            ? `${workMode}${source.width ? ` · ${source.width}×${source.height}` : ''}`
            : 'Generate'
        }
      >
        <SourcePanel
          source={source}
          mode={workMode}
          supportsEdit={Boolean(familyMeta?.supportsEdit)}
          denoise={imgDenoise}
          sourceSizeMode={sourceSizeMode}
          sourceFit={sourceFit}
          outpaint={outpaint}
          disabled={runtime.running}
          onModeChange={(m) => {
            if (m !== 'generate' && !source) {
              setWorkMode(m === 'edit' && !familyMeta?.supportsEdit ? 'img2img' : m);
              setPanelOpen((p) => ({ ...p, source: true }));
              return;
            }
            if (m === 'edit' && !familyMeta?.supportsEdit) return;
            setWorkMode(m);
          }}
          onClear={clearSource}
          onReplaceFile={(file) => void setSourceFromFile(file)}
          onDenoiseChange={setImgDenoise}
          onSourceSizeModeChange={(v) => {
            setSourceSizeMode(v);
            if (v === 'match' && source?.width && source.height) {
              const matched = matchSourceSize(source.width, source.height, sizeMultiple);
              setWidth(matched.width);
              setHeight(matched.height);
              setAspectId('custom');
            }
          }}
          onSourceFitChange={setSourceFit}
          onOutpaintChange={setOutpaint}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="prompt"
        title="Prompt"
        open={panelOpen.prompt}
        onOpenChange={(o) => setSectionOpen('prompt', o)}
        onSolo={() => soloSection('prompt')}
        summary={promptSummary}
      >
        <PromptPanel
          prompt={prompt}
          negativePrompt={negativePrompt}
          positiveTags={resolved.positiveTags}
          negativeTags={resolved.negativeTags}
          disableNegative={resolved.disableNegative}
          disableNegativeReason={
            resolved.familyName
              ? `Negatives are unused for ${resolved.familyName} (encoder / guidance family).`
              : 'Negatives are unused for this family.'
          }
          familyId={resolved.familyId}
          tagsEnabled={resolved.tagsEnabled}
          tokenMode={familyMeta?.promptTokenMode ?? 'clip'}
          tokenMax={familyMeta?.promptMaxTokens ?? 75}
          finalPositive={resolved.finalPositive}
          finalNegative={resolved.finalNegative}
          enhanceConfigured={Boolean(
            serverSettings.enhanceApiUrl.trim() && serverSettings.enhanceModel.trim(),
          )}
          promptPlaceholder={
            workMode === 'edit' ? 'Describe the change…' : 'Describe your image...'
          }
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
          cfg={cfg}
          clipSkip={clipSkip}
          guidance={guidance}
          sampler={sampler}
          checkpoint={primaryModel}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="image"
        title="Image"
        open={panelOpen.image}
        onOpenChange={(o) => setSectionOpen('image', o)}
        onSolo={() => soloSection('image')}
        summary={imageSummary}
      >
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
        <HiresFixControls
          value={hiresFix}
          onChange={setHiresFix}
          disabled={runtime.running}
        />
        <ControlNetPanel
          value={controlNet}
          onChange={setControlNet}
          models={catalog.controlnet}
          controlnetAvailable={Boolean(catalog.available.controlnet)}
          auxAvailable={Boolean(catalog.available.controlnetAux)}
          disabled={runtime.running}
          onUploadImage={async (file) => {
            const src = await uploadFileAsSource(file);
            return { comfyName: src.comfyName, previewUrl: src.previewUrl };
          }}
        />
        <DetailerControls
          value={detailer}
          onChange={setDetailer}
          detectors={catalog.detailer_detectors ?? []}
          available={Boolean(catalog.available.faceDetailer)}
          disabled={runtime.running}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="loras"
        title="LoRAs"
        open={panelOpen.loras}
        onOpenChange={(o) => setSectionOpen('loras', o)}
        onSolo={() => soloSection('loras')}
        summary={loraSummary}
      >
        <LoraPanel
          loras={loras}
          options={catalog.loras}
          onChange={setLoras}
          loading={modelsLoading}
          disabled={runtime.running}
          offline={comfyOk === false}
          onAddModel={() => openAddModel('lora')}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="sampling"
        title="Sampling"
        open={panelOpen.sampling}
        onOpenChange={(o) => setSectionOpen('sampling', o)}
        onSolo={() => soloSection('sampling')}
        summary={samplingSummary}
      >
        <SamplerControls
          steps={steps}
          cfg={cfg}
          sampler={sampler}
          scheduler={scheduler}
          guidance={guidance}
          clipSkip={clipSkip}
          defaults={{
            steps: familyMeta?.settings.steps ?? 25,
            cfg: familyMeta?.settings.cfg ?? 7,
            sampler: familyMeta?.settings.sampler ?? 'euler',
            scheduler: familyMeta?.settings.scheduler ?? 'normal',
            guidance: familyMeta?.settings.guidance,
            clipSkip: familyMeta?.settings.clipSkip,
          }}
          showGuidance={typeof guidance === 'number'}
          showClipSkip={typeof clipSkip === 'number'}
          onStepsChange={setSteps}
          onCfgChange={setCfg}
          onSamplerChange={setSampler}
          onSchedulerChange={setScheduler}
          onGuidanceChange={setGuidance}
          onClipSkipChange={setClipSkip}
          disabled={runtime.running}
        />
      </CollapsibleSection>
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
        queueCount={queue.length}
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
                  compareImage={previousImage}
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
                  record={selectedRecord}
                  upscaleModels={catalog.upscale_models}
                  defaultUpscaler={serverSettings.defaultUpscaler}
                  visible={!runtime.running && Boolean(selectedRecord?.images[0])}
                  busy={runtime.running}
                  onReuse={() => {
                    if (selectedRecord) reuseSettings(selectedRecord);
                  }}
                  onDelete={deleteCurrent}
                  onCopySeed={() => void copySeed()}
                  onUpscale={handleUpscale}
                  onVary={handleVary}
                  onUseAsSource={
                    selectedRecord ? () => void setSourceFromGallery(selectedRecord) : undefined
                  }
                />
                {copyFlash && (
                  <p className="text-center text-[11px] text-muted-foreground">{copyFlash}</p>
                )}
              </div>
            </div>
          </MainStage>
        }
        history={<Gallery {...historyShared} orientation="vertical" showInfo />}
        historyMobile={<Gallery {...historyShared} orientation="horizontal" showInfo={false} />}
      />
      <UndoToast
        open={Boolean(pendingDelete)}
        message="Generation deleted"
        onUndo={() => {
          const restored = undoDelete();
          if (restored?.images[0]) {
            setSelectedId(restored.id);
            setViewImages(restored.images);
          }
        }}
        onDismiss={dismissUndo}
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
