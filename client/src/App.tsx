import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AddModelDialog } from '@/components/controls/AddModelDialog';
import { FinalPromptPreview } from '@/components/controls/FinalPromptPreview';
import { DEFAULT_CONTROLNET_UI, DEFAULT_DETAILER, controlNetPayload, type ControlNetUiState } from '@/lib/generationDefaults';
import { DependencyResolver } from '@/components/controls/DependencyResolver';
import { MapFamilyDialog } from '@/components/controls/MapFamilyDialog';
import { ModelStackPanel } from '@/components/controls/ModelStackPanel';
import { SamplerControls } from '@/components/controls/SamplerControls';
import { SeedControl } from '@/components/controls/SeedControl';
import type { PreferenceProps } from '@/components/settings/AppSettingsPanel';
import { StudioShell } from '@/components/studio/StudioShell';
import { AvoidCard, PromptCard } from '@/components/studio/controls/PromptCards';
import { ExtrasCard, LoraCard, LoraPicker } from '@/components/studio/controls/EnhanceCards';
import { ImageSettings } from '@/components/studio/controls/ImageSettings';
import { ControlNetCard, ImageToImageCard, InpaintCard } from '@/components/studio/controls/ReferenceCards';
import { MaskEditor, type MaskResult, type Pad } from '@/components/studio/editor/MaskEditor';
import { DropDialog, type DropTarget } from '@/components/studio/DropDialog';
import { PromptPopout } from '@/components/studio/controls/PromptPopout';
import { SamplingFooter } from '@/components/studio/controls/SamplingFooter';
import { ContextMenu, type CtxItem } from '@/components/studio/plane/ContextMenu';
import { DetailsPanel } from '@/components/studio/plane/DetailsPanel';
import { HistoryPanel, type HistoryThumb } from '@/components/studio/plane/HistoryPanel';
import { ImagePlane } from '@/components/studio/plane/ImagePlane';
import { Onboarding } from '@/components/studio/plane/Onboarding';
import { PhoneShell, PhoneSheet } from '@/components/studio/phone/PhoneShell';
import { PhoneThumbs, PhoneViewer, type ViewerTile } from '@/components/studio/phone/PhoneViewer';
import { FullscreenImage } from '@/components/studio/phone/FullscreenImage';
import {
  CompareIcon,
  CopyImageIcon,
  DownloadIcon,
  EditIcon,
  EnhanceIcon,
  InpaintIcon,
  PinIcon,
  UpscaleIcon,
  UseAsBaseIcon,
  VaryIcon,
} from '@/components/studio/plane/icons';
import { randomPrompt } from '@/components/studio/controls/randomPrompt';
import { derivedKind, outputSize, tileId, type FailedJob, type PlaneEntry, type Tile } from '@/components/studio/plane/layout';
import { downloadZip } from '@/lib/zip';
import {
  StCard,
  StChipFace,
  StMenuButton,
  StMenuItem,
  StScrollArea,
  StSection,
} from '@/components/studio/controls/primitives';
import { usePromptPrefs } from '@/lib/promptPrefs';
import { scaleAspectPresets } from '@/constants/aspectRatios';
import { useFamilies } from '@/hooks/useFamilies';
import { CancelledError, useGeneration } from '@/hooks/useGeneration';
import { useHistory } from '@/hooks/useHistory';
import { useModels } from '@/hooks/useModels';
import { useServerSettings } from '@/hooks/useServerSettings';
import { useUiSettings } from '@/hooks/useUiSettings';
import {
  imageUrl,
  fetchHealth,
  fetchPreviewSettings,
  fetchSystemStats,
  mapCheckpointFamily,
  resolvePresetsApi,
  startComfyApi,
  updatePreviewQuality,
  fetchLoraMeta,
  type LoraMeta,
} from '@/lib/api';
import { parseImageSettings } from '@/lib/imageMeta';
import { shortModelName } from '@/lib/modelProfiles';
import {
  autoPickStack,
  evaluateReadiness,
  inferFamilyFromDiffusion,
} from '@/lib/modelReadiness';
import { stripInjectedTags } from '@/lib/presetPrompt';
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
  QueuedJob,
  SourceImageState,
  UpscaleRequest,
  VaryStrength,
  SourceSizeMode,
  SystemStatsSummary,
  WorkMode,
} from '@/types/generation';
import type { ResolvedPresets } from '@/types/presets';
import { newId } from '@/lib/uid';
import { canCopyImages, copyTextToClipboard } from '@/lib/clipboard';

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
  qualityPresets: [],
  negativePresets: [],
  qualityPreset: null,
  negativePreset: null,
};

/** True below the desktop layout's minimum width — phones and narrow windows get the phone layout. */
function useNarrowViewport(maxWidth = 899) {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

export default function App() {
  const narrow = useNarrowViewport();
  const [promptPrefs, setPromptPrefs] = usePromptPrefs();
  const [promptPanelOpen, setPromptPanelOpen] = useState(false);
  const [loraPickerOpen, setLoraPickerOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  /** Studio plane / History */
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [histQuery, setHistQuery] = useState('');
  const [histModel, setHistModel] = useState('all');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  /** Selected tile that isn't a finished image (the running job) — overrides the record selection */
  /** Inpaint & extend editor (open), and the saved mask that goes with the base image */
  const [maskEditor, setMaskEditor] = useState<{ src: string; record?: GenerationRecord; index?: number } | null>(null);
  const [inpaint, setInpaint] = useState<{ sourceName: string; fromImage: string | null; mask: HTMLCanvasElement | null; maskName: string | null; pad: Pad; coverage: number; W: number; H: number } | null>(null);
  /** A file being dragged over the studio, or a pasted image waiting for a choice */
  const [drop, setDrop] = useState<{ via: 'drop' | 'paste'; png: boolean; name: string | null; over: DropTarget | null; file: File | null } | null>(null);
  /** Mask being uploaded after "Add to references" (reopening waits for it) */
  const [savingMask, setSavingMask] = useState(false);
  /** Phone: open bottom sheet, expanded controls, compare on the viewer */
  const [phoneSheet, setPhoneSheet] = useState<null | 'tools' | 'panel' | 'loraPick' | 'actions' | 'models' | 'details'>(null);
  const [phoneExpanded, setPhoneExpanded] = useState(false);
  const [phoneCompare, setPhoneCompare] = useState(false);
  const [phoneFull, setPhoneFull] = useState(false);
  const [planeSel, setPlaneSel] = useState<string | null>(null);
  const planeSelRef = useRef<string | null>(null);
  planeSelRef.current = planeSel;
  const [planeFocus, setPlaneFocus] = useState<{ id: string; n: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; recordId: string; index: number } | null>(null);
  const studioRef = useRef(false);
  studioRef.current = !narrow;
  const requestFocus = useCallback((id: string) => setPlaneFocus((f) => ({ id, n: (f?.n ?? 0) + 1 })), []);
  const { catalog, loading: modelsLoading, reload: reloadModels } = useModels();
  const { families } = useFamilies();
  const {
    items,
    loading: histLoading,
    reload,
    softDelete,
    undoDelete,
    pendingDelete,
  } = useHistory();
  const [comfyOk, setComfyOk] = useState<boolean | null>(null);
  /** The Darkroom server itself didn't answer (e.g. restarting) — not the same as ComfyUI being down */
  const [serverDown, setServerDown] = useState(false);
  /** ComfyUI was reachable and just dropped: show "Reconnecting…" for a while before "offline" */
  const [reconnecting, setReconnecting] = useState(false);
  const [retryingComfy, setRetryingComfy] = useState(false);
  const prevComfy = useRef<boolean | null>(null);
  useEffect(() => {
    const was = prevComfy.current;
    prevComfy.current = comfyOk;
    if (comfyOk) {
      setReconnecting(false);
      return;
    }
    if (was === true && comfyOk === false) {
      setReconnecting(true);
      const t = window.setTimeout(() => setReconnecting(false), 20_000);
      return () => window.clearTimeout(t);
    }
  }, [comfyOk]);
  const retryComfy = async () => {
    setRetryingComfy(true);
    try {
      const h = await fetchHealth();
      setServerDown(false);
      setComfyOk(h.comfy);
    } catch {
      setServerDown(true);
      setComfyOk(false);
    } finally {
      window.setTimeout(() => setRetryingComfy(false), 500);
    }
  };
  const [remoteMode, setRemoteMode] = useState(false);
  const [startingComfy, setStartingComfy] = useState(false);
  const [uiSettingsOpen, setUiSettingsOpen] = useState(false);
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
    emptyTrash,
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
  /** Chosen Quality / Negative preset levels (null = the family's default) */
  const [qualityPreset, setQualityPreset] = useState<string | null>(null);
  const [negativePreset, setNegativePreset] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedPresets>(emptyResolved);

  const [prompt, setPrompt] = useState('');
  const [loraMeta, setLoraMeta] = useState<Record<string, LoraMeta>>({});
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
          qualityPreset,
          negativePreset,
          userPositive: prompt,
          userNegative: negativePrompt,
        });
        if (!cancelled) {
          resolveSeq.current += 1;
          setResolved({ ...emptyResolved, ...next });
        }
      } catch {
        if (!cancelled) {
          resolveSeq.current += 1;
          setResolved(emptyResolved);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [primaryModel, styleId, dismissedPositive, dismissedNegative, qualityPreset, negativePreset, prompt, negativePrompt]);

  // When family or style identity changes: apply settings + scale aspect
  /** Current size, read by the family-change effect without re-running it */
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };
  const identityKey = `${resolved.familyId ?? ''}|${resolved.styleId ?? ''}|${resolved.mapped}`;
  const prevIdentity = useRef('');
  const prevFamily = useRef<string | null>(null);
  /** Count of completed preset resolves; lets Reuse claim the identity change it causes. */
  const resolveSeq = useRef(0);
  /** resolveSeq at the moment Reuse ran (null = no Reuse pending). */
  const reuseHoldSeq = useRef<number | null>(null);
  useEffect(() => {
    if (identityKey === prevIdentity.current) return;
    prevIdentity.current = identityKey;

    // Identity changed by Reuse: keep the restored style / dismissed tags / sampler / size
    // instead of re-applying family defaults over them.
    const fromReuse =
      reuseHoldSeq.current !== null && resolveSeq.current === reuseHoldSeq.current + 1;
    reuseHoldSeq.current = null;
    if (fromReuse) {
      if (resolved.familyId) prevFamily.current = resolved.familyId;
      return;
    }

    if (!resolved.mapped || !resolved.familyId) return;

    const familyChanged = prevFamily.current !== resolved.familyId;
    if (familyChanged) {
      prevFamily.current = resolved.familyId;
      setDismissedPositive([]);
      setDismissedNegative([]);
      setQualityPreset(null);
      setNegativePreset(null);
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
      // Presets are landscape; keep a portrait choice portrait
      const portrait = sizeRef.current.height > sizeRef.current.width;
      setWidth(portrait ? match.height : match.width);
      setHeight(portrait ? match.width : match.height);
    }
  }, [identityKey, resolved, familyMeta, styleId, aspectId]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const h = await fetchHealth();
        if (!cancelled) {
          setServerDown(false);
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
          setServerDown(true);
          setComfyOk(false);
          setSystemStats(null);
        }
      }
    };
    void check();
    const intervalMs = startingComfy ? 2_000 : comfyOk === false ? 5_000 : 10_000;
    const id = window.setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [reloadModels, comfyOk, startingComfy]);

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
      const followRun = planeSelRef.current?.startsWith('running:') ?? false;
      const runIndex = followRun ? Number(planeSelRef.current!.split(':')[1]) || 0 : 0;
      setPlaneSel(null);
      if (followRun) {
        setSelectedId(record.id);
        setViewImages(record.images);
        setSelectedIndex(Math.min(runIndex, Math.max(0, record.images.length - 1)));
        requestFocus(tileId(record.id, Math.min(runIndex, Math.max(0, record.images.length - 1))));
      } else if (uiSettings.jumpToNewest || !selectedId) {
        setSelectedId(record.id);
        setViewImages(record.images);
        setSelectedIndex(0);
        requestFocus(tileId(record.id, 0));
      }
    },
    [reload, requestFocus, selectedId, uiSettings.jumpToNewest],
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
      if (workMode === 'outpaint' && source?.width && source.height) {
        // Output is the base image plus the extension
        w = source.width + outpaint.left + outpaint.right;
        h = source.height + outpaint.top + outpaint.bottom;
      }

      const generationMode =
        workMode === 'generate'
          ? 'txt2img'
          : workMode === 'img2img'
            ? 'img2img'
            : workMode === 'outpaint'
              ? 'outpaint'
              : 'edit';

      const activeLoras = loras
        .filter((l) => l.enabled !== false)
        .map((l) => ({ name: l.name, strength_model: l.strength_model, strength_clip: l.strength_clip }));
      const base: GenerationSettings = {
        prompt: resolved.finalPositive,
        negative_prompt: resolved.finalNegative,
        // Prompt-box text + preset state, so Reuse doesn't re-inject preset tags
        userPrompt: prompt,
        userNegative: negativePrompt,
        familyId: resolved.familyId ?? undefined,
        styleId: resolved.styleId ?? undefined,
        dismissedPositive: dismissedPositive.length ? dismissedPositive : undefined,
        dismissedNegative: dismissedNegative.length ? dismissedNegative : undefined,
        qualityPreset: resolved.qualityPreset ?? undefined,
        negativePreset: resolved.negativePreset ?? undefined,
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
        loras: activeLoras.length ? activeLoras : undefined,
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
        maskImage: workMode === 'outpaint' && inpaint?.sourceName === source?.comfyName ? inpaint?.maskName ?? undefined : undefined,
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
      dismissedNegative,
      dismissedPositive,
      familyMeta?.editStrategy,
      familyMeta?.preferredInpaintModel,
      guidance,
      height,
      hiresFix,
      imgDenoise,
      inpaint,
      loras,
      modelMode,
      negativePrompt,
      outpaint,
      prompt,
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

  /** Runs one job; resolves to the error message when it failed (null when done or cancelled). */
  const runGenerate = useCallback(
    async (settings: GenerationSettings): Promise<string | null> => {
      try {
        await generate(settings, {
          livePreview: uiSettings.livePreview,
          previewMethod:
            perPromptPreview === true
              ? qualityToPreviewMethod(uiSettings.previewQuality)
              : undefined,
        });
        return null;
      } catch (err) {
        if (err instanceof CancelledError) return null;
        return err instanceof Error ? err.message : String(err);
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
          const failure = await runGenerate(next.settings);
          if (failure) {
            setFailedJobs((prev) => [
              { id: next.id, settings: next.settings, label: next.label, error: failure, at: Date.now() },
              ...prev,
            ]);
          }
          syncQueue(queueRef.current.filter((j) => j.id !== next.id));
          setActiveQueueId(null);
        }
        if (haltForeverRef.current || !foreverRef.current) break;
        const nextSeed = randomSeed();
        if (!seedLocked) setSeed(nextSeed);
        const settings = buildSettings(nextSeed);
        const job: QueuedJob = {
          id: newId(),
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

  const applySource = useCallback(
    (next: SourceImageState, preferMode: WorkMode = 'img2img') => {
      setSource(next);
      setWorkMode((prev) => (prev === 'generate' ? preferMode : prev));
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
    async (item: GenerationRecord, index = 0): Promise<SourceImageState | null> => {
      const img = item.images[index] ?? item.images[0];
      if (!img) return null;
      try {
        const next = await useGalleryAsSource(img, item.id);
        applySource(next, 'img2img');
        return next;
      } catch (err) {
        setCopyFlash(err instanceof Error ? err.message : 'Source upload failed');
        window.setTimeout(() => setCopyFlash(null), 2500);
        return null;
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
      requestFocus(tileId(first.id, 0));
    }
  }, [histLoading, items, requestFocus, selectedId, viewImages.length]);

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
      id: newId(),
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
        id: newId(),
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
      const r = await startComfyApi();
      if (r.alreadyRunning) {
        setServerDown(false);
        setComfyOk(true);
        setStartingComfy(false);
      }
      // Otherwise "Starting…" stays until the health poll sees ComfyUI (or gives up below)
    } catch (err) {
      setStartingComfy(false);
      const unreachable = err instanceof TypeError || /NetworkError|Failed to fetch|Load failed/i.test(String(err));
      setCopyFlash(
        unreachable
          ? 'Can’t reach the Darkroom server — it may be restarting. Try again in a moment.'
          : err instanceof Error
            ? err.message
            : 'Failed to start ComfyUI',
      );
      window.setTimeout(() => setCopyFlash(null), 4000);
    }
  }, []);
  // ComfyUI answered (or it's been too long): stop showing "Starting…"
  useEffect(() => {
    if (!startingComfy) return;
    if (comfyOk) {
      setStartingComfy(false);
      return;
    }
    const t = window.setTimeout(() => {
      setStartingComfy(false);
      setCopyFlash('ComfyUI didn’t start within 3 minutes — check logs/comfyui.log');
      window.setTimeout(() => setCopyFlash(null), 5000);
    }, 180_000);
    return () => window.clearTimeout(t);
  }, [startingComfy, comfyOk]);

  const applyDroppedSettings = useCallback(async (file: File) => {
    const meta = await parseImageSettings(file);
    if (!meta) {
      setCopyFlash('No settings found in image');
      window.setTimeout(() => setCopyFlash(null), 2000);
      return;
    }
    const s = meta.settings;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    const strList = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    if (str(s?.userPrompt) != null) {
      // Darkroom PNG: restore the prompt box + preset state exactly
      reuseHoldSeq.current = resolveSeq.current;
      setPrompt(str(s?.userPrompt) ?? '');
      setNegativePrompt(str(s?.userNegative) ?? '');
      setStyleId(str(s?.styleId));
      setDismissedPositive(strList(s?.dismissedPositive));
      setDismissedNegative(strList(s?.dismissedNegative));
      setQualityPreset(str(s?.qualityPreset));
      setNegativePreset(str(s?.negativePreset));
    } else {
      const promptTemplate = str(s?.promptTemplate);
      const negativeTemplate = str(s?.negativeTemplate);
      if (promptTemplate ?? meta.prompt) setPrompt(promptTemplate ?? meta.prompt ?? '');
      if (negativeTemplate != null) setNegativePrompt(negativeTemplate);
      else if (meta.negative_prompt != null) setNegativePrompt(meta.negative_prompt);
    }
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
            if (studioRef.current) setDrop({ via: 'paste', png: file.type === 'image/png', name: file.name || 'Pasted image', over: null, file });
            else void setSourceFromFile(file);
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
        !studioRef.current &&
        (eventMatchesShortcut(e, shortcuts.prevHistory) ||
          eventMatchesShortcut(e, shortcuts.nextHistory))
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
    // Let the preset-identity effect know this change came from Reuse
    reuseHoldSeq.current = resolveSeq.current;
    if (typeof s.userPrompt === 'string') {
      setPrompt(s.userPrompt);
      setNegativePrompt(s.userNegative ?? '');
    } else {
      // Older records only have the final prompt (preset tags + user text):
      // show it now, then strip the preset tags so they aren't injected twice.
      const legacyPositive = s.promptTemplate ?? s.prompt;
      const legacyNegative = s.negativeTemplate ?? s.negative_prompt;
      setPrompt(legacyPositive);
      setNegativePrompt(legacyNegative);
      void resolvePresetsApi({
        checkpoint: s.modelMode === 'split' ? s.unet || s.checkpoint : s.checkpoint,
        styleId: s.styleId ?? null,
        dismissedPositive: [],
        dismissedNegative: [],
        userPositive: '',
        userNegative: '',
      })
        .then((presets) => {
          setPrompt((cur) =>
            cur === legacyPositive ? stripInjectedTags(cur, presets.positiveTags) : cur,
          );
          setNegativePrompt((cur) =>
            cur === legacyNegative ? stripInjectedTags(cur, presets.negativeTags) : cur,
          );
        })
        .catch(() => {});
    }
    setStyleId(s.styleId ?? null);
    setDismissedPositive(s.dismissedPositive ?? []);
    setDismissedNegative(s.dismissedNegative ?? []);
    setQualityPreset(s.qualityPreset ?? null);
    setNegativePreset(s.negativePreset ?? null);
    setAspectId('custom');
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
  };

  const selectItem = (item: GenerationRecord, index = 0) => {
    setSelectedId(item.id);
    setViewImages(item.images);
    setSelectedIndex(index);
  };

  const selectedRecord = items.find((i) => i.id === selectedId) ?? null;
  /** Prefer history selection when idle so delete/navigation update the canvas. */
  /** Prompt + preset-state fields carried from a parent record (Vary / Upscale). */
  const parentPromptFields = (
    parent: GenerationSettings,
    fallback: GenerationSettings,
  ): Partial<GenerationSettings> => ({
    prompt: parent.prompt || fallback.prompt,
    negative_prompt: parent.negative_prompt ?? fallback.negative_prompt,
    userPrompt: parent.userPrompt,
    userNegative: parent.userNegative,
    familyId: parent.familyId,
    styleId: parent.styleId,
    dismissedPositive: parent.dismissedPositive,
    dismissedNegative: parent.dismissedNegative,
    qualityPreset: parent.qualityPreset,
    negativePreset: parent.negativePreset,
  });

  const handleVary = useCallback(
    (strength: VaryStrength) => {
      if (!selectedRecord?.images[0] || !readiness.ready) return;
      const srcImage = selectedRecord.images[selectedIndex] ?? selectedRecord.images[0];
      const denoise = strength === 'subtle' ? 0.3 : 0.6;
      const nextSeed = randomSeed();
      const base = buildSettings(nextSeed);
      enqueueJob(
        {
          ...base,
          ...parentPromptFields(selectedRecord.settings, base),
          width: selectedRecord.settings.width,
          height: selectedRecord.settings.height,
          seed: nextSeed,
          generationMode: 'img2img',
          sourceImage: srcImage,
          parentId: selectedRecord.id,
          denoise,
          hiresFix: undefined,
          upscale: undefined,
        },
        `Vary ${strength}`,
      );
    },
    [buildSettings, enqueueJob, readiness.ready, selectedIndex, selectedRecord],
  );

  const handleUpscale = useCallback(
    (req: UpscaleRequest) => {
      if (!selectedRecord?.images[0] || !readiness.ready) return;
      const nextSeed = randomSeed();
      const base = buildSettings(nextSeed);
      enqueueJob(
        {
          ...base,
          ...parentPromptFields(selectedRecord.settings, base),
          width: selectedRecord.settings.width,
          height: selectedRecord.settings.height,
          seed: nextSeed,
          generationMode: 'upscale',
          sourceImage: selectedRecord.images[selectedIndex] ?? selectedRecord.images[0],
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
        req.refine ? `Enhance ${req.scale}×` : `Upscale ${req.scale}×`,
      );
    },
    [buildSettings, enqueueJob, readiness.ready, selectedIndex, selectedRecord],
  );


  const showMapDialog =
    Boolean(primaryModel) && !resolved.mapped && families.length > 0 && comfyOk !== false;


  const modelPanel = (
    <>
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
        offerGguf={Boolean(familyMeta?.supportsGguf) && !catalog.available.ggufUnet && !readiness.needsGguf}
        onAddModel={(t) => {
          setModelMenuOpen(false);
          openAddModel(t);
        }}
      />
    </>
  );

  const activeStyleId = styleId ?? resolved.styleId;
  const activeStyleName = styles.find((st) => st.id === activeStyleId)?.name ?? null;
  const modelMissing = readiness.missing.length > 0;
  const insertIntoPrompt = (text: string, mode: 'append' | 'replace') => {
    if (mode === 'replace') return setPrompt(text);
    const base = prompt.trim().replace(/,\s*$/, '');
    setPrompt(base ? `${base}, ${text}` : text);
  };
  const stopCurrent = () => {
    if (activeQueueId) void cancelQueueJob(activeQueueId);
    else void handleCancel();
  };
  const usingGuidance = typeof guidance === 'number';
  // Matches the reference card's title: Inpaint, Extend, or Inpaint & extend
  const inpaintVerb = (() => {
    const masked = Boolean(inpaint && inpaint.coverage > 0);
    const extended = outpaint.left + outpaint.right + outpaint.top + outpaint.bottom > 0;
    return masked && extended ? 'Inpaint & extend' : extended ? 'Extend' : 'Inpaint';
  })();
  const workVerb = workMode === 'edit' ? 'Edit' : workMode === 'outpaint' ? inpaintVerb : 'Generate';

  /** The studio's controls column (phase 2 of the rebuild). */
  // What each LoRA was made for, trigger words and previews; re-read when a picker opens (new files)
  const lorasPicking = loraPickerOpen || phoneSheet === 'loraPick';
  const loraCount = catalog.loras.length;
  useEffect(() => {
    let live = true;
    fetchLoraMeta()
      .then((r) => {
        if (live) setLoraMeta(Object.fromEntries(r.items.map((m) => [m.name, m])));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [lorasPicking, loraCount]);
  const loraContext = { meta: loraMeta, familyId: resolved.familyId, familyName: resolved.familyName };

  const renderStudioControls = (layout: 'desktop' | 'phone' = 'desktop') => {
    const phone = layout === 'phone';
    const modelStyleRow = (
        <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2 px-3.5 pb-3">
          <StMenuButton
            label="Model"
            tip={modelMissing ? 'Some model files are missing — click to fix' : 'Choose the model. Presets, tags and defaults follow it.'}
            open={modelMenuOpen}
            onOpenChange={setModelMenuOpen}
            menuStyle={{ width: 'calc(var(--st-left-w, 360px) - 28px)', padding: 12, gap: 12 }}
            button={
              <StChipFace
                label={resolved.familyName ? `Model · ${resolved.familyName}` : 'Model'}
                value={primaryModel ? shortModelName(primaryModel) : 'Choose a model'}
                dot={modelMissing ? '#e2b44f' : undefined}
              />
            }
          >
            {modelPanel}
          </StMenuButton>
          <StMenuButton
            label="Style"
            tip={resolved.mapped ? 'Style for this model — sets preset tags and defaults' : 'Pick a model family first'}
            disabled={runtime.running || !resolved.mapped || styles.length === 0}
            menuStyle={{ left: 'auto', right: 0, minWidth: 200 }}
            button={<StChipFace label="Style" value={activeStyleName ?? (styles.length ? 'Default' : 'None')} />}
          >
            {(close) =>
              styles.map((st) => (
                <StMenuItem
                  key={st.id}
                  title={st.name}
                  selected={st.id === activeStyleId}
                  onClick={() => {
                    setStyleId(st.id);
                    setDismissedPositive([]);
                    setDismissedNegative([]);
                    close();
                  }}
                />
              ))
            }
          </StMenuButton>
        </div>
    );
    const missingCard = (
      <>
        {modelMissing && !modelMenuOpen ? (
          <button
            type="button"
            onClick={() => setModelMenuOpen(true)}
            className="flex items-center gap-2.5 rounded-xl p-3 text-left"
            style={{ background: 'rgba(226,180,79,.08)', border: '1px solid rgba(226,180,79,.4)', color: 'var(--s-text)' }}
          >
            <span className="st-dot" style={{ background: '#e2b44f' }} />
            <span className="min-w-0 flex-1 text-[13px]">
              Missing: {readiness.missing.map((m) => m.label).join(', ')}. Open Model to fix.
            </span>
          </button>
        ) : null}
      </>
    );
    const promptCard = (
          <PromptCard
            value={prompt}
            onChange={setPrompt}
            familyId={resolved.familyId}
            tagsEnabled={resolved.tagsEnabled}
            placeholder={workMode === 'edit' ? 'Describe the change…' : 'Describe your image…'}
            disabled={runtime.running}
            tokenMode={familyMeta?.promptTokenMode ?? 'clip'}
            tokenMax={familyMeta?.promptMaxTokens ?? 75}
            injected={resolved.positiveTags}
            qualityLevels={resolved.qualityPresets}
            quality={resolved.qualityPreset}
            onQuality={setQualityPreset}
            prefs={promptPrefs}
            enhanceConfigured={Boolean(serverSettings.enhanceApiUrl.trim() && serverSettings.enhanceModel.trim())}
            onOpenPreferences={() => setUiSettingsOpen(true)}
            onShowFinal={() => setFinalOpen((o) => !o)}
            panelOpen={phone ? phoneSheet === 'panel' : promptPanelOpen}
            onTogglePanel={
              phone
                ? () => setPhoneSheet('panel')
                : () => {
                    setLoraPickerOpen(false);
                    setPromptPanelOpen((o) => !o);
                  }
            }
            textHeight={phone ? (phoneExpanded ? 'h-[132px]' : 'h-[78px]') : undefined}
          />
    );
    const moreCards = (
      <>
        <AvoidCard
          value={negativePrompt}
          onChange={setNegativePrompt}
          familyId={resolved.familyId}
          tagsEnabled={resolved.tagsEnabled}
          disabled={runtime.running}
          locked={resolved.disableNegative}
          lockedReason={
            resolved.familyName ? `${resolved.familyName} doesn’t use a negative prompt.` : 'This model doesn’t use a negative prompt.'
          }
          levels={resolved.negativePresets}
          preset={resolved.negativePreset}
          onPreset={setNegativePreset}
          prefs={promptPrefs}
          onSwap={() => {
            const p = prompt;
            setPrompt(negativePrompt);
            setNegativePrompt(p);
          }}
        />

        {finalOpen ? (
          <StCard>
            <div className="st-card-body st-embedded pt-3.5">
              <FinalPromptPreview
                open
                onOpenChange={setFinalOpen}
                positive={resolved.finalPositive}
                negative={resolved.finalNegative}
                cfg={cfg}
                clipSkip={clipSkip}
                guidance={guidance}
                sampler={sampler}
                checkpoint={primaryModel}
              />
            </div>
          </StCard>
        ) : null}

        <StSection>Reference images</StSection>
        {workMode === 'outpaint' && source ? (
          <InpaintCard
            source={source}
            title={inpaintTitle}
            summary={inpaintSummary}
            extended={outpaint.left + outpaint.right + outpaint.top + outpaint.bottom > 0}
            denoise={imgDenoise}
            onDenoise={setImgDenoise}
            feather={outpaint.feather}
            onFeather={(v) => setOutpaint((o) => ({ ...o, feather: v }))}
            disabled={runtime.running || savingMask}
            onEdit={() => setMaskEditor({ src: source.previewUrl })}
            onStop={stopInpainting}
          />
        ) : (
        <ImageToImageCard
          source={source}
          mode={workMode}
          supportsEdit={Boolean(familyMeta?.supportsEdit)}
          denoise={imgDenoise}
          onDenoise={setImgDenoise}
          sizeMode={sourceSizeMode}
          onSizeMode={(v) => {
            setSourceSizeMode(v);
            if (v === 'match' && source?.width && source.height) {
              const matched = matchSourceSize(source.width, source.height, sizeMultiple);
              setWidth(matched.width);
              setHeight(matched.height);
              setAspectId('custom');
            }
          }}
          fit={sourceFit}
          onFit={setSourceFit}
          outputW={width}
          outputH={height}
          disabled={runtime.running}
          canUseSelected={Boolean(selectedRecord)}
          onUseSelected={() => {
            if (selectedRecord) void setSourceFromGallery(selectedRecord);
          }}
          onUpload={(f) => void setSourceFromFile(f)}
          onClear={clearSource}
          onMode={(m) => {
            if (m === 'edit' && !familyMeta?.supportsEdit) return;
            setWorkMode(m);
          }}
          onOpenEditor={() => source && setMaskEditor({ src: source.previewUrl })}
        />
        )}
        <ControlNetCard
          value={controlNet}
          onChange={setControlNet}
          models={catalog.controlnet}
          available={Boolean(catalog.available.controlnet)}
          auxAvailable={Boolean(catalog.available.controlnetAux)}
          disabled={runtime.running}
          canUseSelected={Boolean(selectedRecord?.images[0])}
          onUseSelected={async () => {
            const img = selectedRecord?.images[0];
            if (!img || !selectedRecord) return null;
            const src = await useGalleryAsSource(img, selectedRecord.id);
            return { comfyName: src.comfyName, previewUrl: src.previewUrl };
          }}
          onUpload={async (file) => {
            const src = await uploadFileAsSource(file);
            return { comfyName: src.comfyName, previewUrl: src.previewUrl };
          }}
          onAddModel={() => openAddModel('controlnet')}
        />

        <StSection>Image settings</StSection>
        <ImageSettings
          presets={resolved.aspectPresets}
          width={width}
          height={height}
          aspectId={aspectId}
          onSize={(w, h, id) => {
            setWidth(w);
            setHeight(h);
            setAspectId(id);
          }}
          batch={batchSize}
          onBatch={setBatchSize}
          sizeMultiple={sizeMultiple}
          disabled={runtime.running}
        />

        <StSection>Enhance</StSection>
        <LoraCard
          loras={loras}
          onChange={setLoras}
          {...loraContext}
          prompt={prompt}
          onPrompt={setPrompt}
          pickerOpen={phone ? phoneSheet === 'loraPick' : loraPickerOpen}
          onPickerOpen={(o) => {
            if (phone) {
              setPhoneSheet(o ? 'loraPick' : null);
              return;
            }
            if (o) setPromptPanelOpen(false);
            setLoraPickerOpen(o);
          }}
          disabled={runtime.running}
        />
        <ExtrasCard
          hires={hiresFix}
          onHires={setHiresFix}
          hiresApplies={workMode === 'generate'}
          detailer={detailer}
          onDetailer={setDetailer}
          detectors={catalog.detailer_detectors ?? []}
          detailerAvailable={Boolean(catalog.available.faceDetailer)}
          disabled={runtime.running}
        />
      </>
    );
    const footer = (
        <SamplingFooter
          connection={
            serverDown
              ? {
                  kind: 'server',
                  remote: remoteMode,
                  retrying: retryingComfy,
                  onRetry: () => void retryComfy(),
                  starting: false,
                  onStart: () => {},
                }
              : comfyOk === false
              ? {
                  kind: startingComfy ? 'starting' : reconnecting ? 'reconnecting' : 'offline',
                  remote: remoteMode,
                  retrying: retryingComfy,
                  onRetry: () => void retryComfy(),
                  starting: startingComfy,
                  onStart: () => void handleStartComfy(),
                }
              : null
          }
          steps={steps}
          cfgLabel={usingGuidance ? 'Guidance' : 'CFG'}
          cfgValue={usingGuidance ? (guidance as number) : cfg}
          seedLocked={seedLocked}
          seed={seed}
          onToggleSeedLock={() => setSeedLocked((l) => !l)}
          sampler={sampler}
          expanded={
            <div className="st-embedded flex flex-col gap-3">
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
                samplerOptions={catalog.samplers}
                schedulerOptions={catalog.schedulers}
                showGuidance={usingGuidance}
                showClipSkip={typeof clipSkip === 'number'}
                onStepsChange={setSteps}
                onCfgChange={setCfg}
                onSamplerChange={setSampler}
                onSchedulerChange={setScheduler}
                onGuidanceChange={setGuidance}
                onClipSkipChange={setClipSkip}
                disabled={runtime.running}
              />
              <SeedControl seed={seed} locked={seedLocked} onSeedChange={setSeed} onLockedChange={setSeedLocked} disabled={runtime.running} />
            </div>
          }
          generateLabel={`${workVerb} ${batchSize} image${batchSize > 1 ? 's' : ''}`}
          onGenerate={() => void handleGenerate()}
          generateDisabled={Boolean(generateBlockedReason) || !readiness.ready}
          disabledReason={generateBlockedReason}
          running={runtime.running}
          progressStep={runtime.progressStep}
          progressMax={runtime.progressMax}
          onStop={stopCurrent}
          queue={queue}
          activeQueueId={activeQueueId}
          onRemoveJob={(id) => void cancelQueueJob(id)}
          onClearQueue={() => syncQueue(queueRef.current.filter((j) => j.id === activeQueueId))}
          error={runtime.error}
          notice={copyFlash}
        />
    );
    if (phone) {
      return (
        <section className="st-ph-controls" data-tip-zone="above" style={{ maxHeight: phoneExpanded ? '74dvh' : '58dvh' }}>
          <div className="st-scroll flex min-h-0 flex-col gap-2.5 overflow-y-auto px-3.5 pb-1">
            <button
              type="button"
              className="st-ph-handle"
              onClick={() => setPhoneExpanded((o) => !o)}
              aria-expanded={phoneExpanded}
              aria-label={phoneExpanded ? 'Fewer settings' : 'More settings'}
              data-tip={phoneExpanded ? 'Fewer settings' : 'More settings — avoid, size, references, LoRAs'}
            >
              <span />
            </button>
            {missingCard}
            {promptCard}
            {phoneExpanded ? moreCards : null}
          </div>
          {footer}
        </section>
      );
    }
    return (
      <>
        {modelStyleRow}
        <StScrollArea>
          {missingCard}
          {promptCard}
          {moreCards}
        </StScrollArea>
        {footer}
        {promptPanelOpen && !uiSettings.studioLeftCollapsed ? (
          <PromptPopout
            prompt={prompt}
            onInsert={insertIntoPrompt}
            embeddings={catalog.embeddings}
            prefs={promptPrefs}
            onPrefs={setPromptPrefs}
            onClose={() => setPromptPanelOpen(false)}
          />
        ) : null}
        {loraPickerOpen && !uiSettings.studioLeftCollapsed ? (
          <LoraPicker
            {...loraContext}
            options={catalog.loras}
            loras={loras}
            loading={modelsLoading}
            onAdd={(name) => setLoras((prev) => (prev.some((l) => l.name === name) ? prev : [...prev, { name, strength_model: 1, strength_clip: 1, enabled: true }]))}
            onAddModel={() => openAddModel('lora')}
            onClose={() => setLoraPickerOpen(false)}
          />
        ) : null}
      </>
    );
  };
  const preferenceProps: PreferenceProps = {
    ui: uiSettings,
    onUiPatch: updateUiSettings,
    onLivePreviewChange: handleLivePreviewChange,
    onPreviewQualityChange: (q) => void handlePreviewQualityChange(q),
    perPromptPreview,
    server: serverSettings,
    serverHints,
    diskUsage,
    serverLoading: serverSettingsLoading,
    onServerPatch: (p) => patchServerSettings(p),
    onCopyDiagnostics: async () => {
      await copyDiagnostics();
    },
    onBackupNow: async () => {
      await backupNow();
    },
    onEmptyTrash: emptyTrash,
  };

  // ---------- Studio: image plane, History, details ----------
  const flash = useCallback((text: string, ms = 1800) => {
    setCopyFlash(text);
    window.setTimeout(() => setCopyFlash((cur) => (cur === text ? null : cur)), ms);
  }, []);
  const recordModelKey = (r: GenerationRecord) =>
    (r.settings.modelMode === 'split' ? r.settings.unet || r.settings.checkpoint : r.settings.checkpoint) || 'unknown';
  const histModels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of items) counts.set(recordModelKey(r), (counts.get(recordModelKey(r)) ?? 0) + r.images.length);
    return [...counts.entries()].map(([key, count]) => ({ key, name: shortModelName(key), count }));
  }, [items]);
  const activeJob = queue.find((j) => j.id === activeQueueId) ?? null;
  const runProgress = runtime.running ? (runtime.progressMax ? runtime.progressStep / runtime.progressMax : 0) : null;
  const planeEntries = useMemo<PlaneEntry[]>(() => {
    const q = histQuery.trim().toLowerCase();
    const records = items
      .filter((r) => r.images.length)
      .filter((r) => !pinnedOnly || favorites.has(r.id))
      .filter((r) => histModel === 'all' || recordModelKey(r) === histModel)
      .filter((r) => !q || `${r.settings.userPrompt ?? ''} ${r.settings.prompt}`.toLowerCase().includes(q));
    const rows: Array<{ at: number; entry: PlaneEntry }> = [
      ...records.map((r) => ({ at: r.createdAt, entry: { kind: 'record' as const, key: r.id, record: r, images: r.images.map(imageUrl), pinned: favorites.has(r.id) } })),
      ...(pinnedOnly || histModel !== 'all' || q ? [] : failedJobs.map((f) => ({ at: f.at, entry: { kind: 'failed' as const, key: `failed-${f.id}`, failed: f } }))),
    ].sort((a, b) => b.at - a.at);
    const list = rows.map((r) => r.entry);
    if (runtime.running && activeJob) {
      list.unshift({ kind: 'running', key: 'running', settings: activeJob.settings, previewUrl: runtime.previewUrl, progress: runProgress ?? 0 });
    }
    return list;
  }, [items, pinnedOnly, favorites, histModel, histQuery, failedJobs, runtime.running, runtime.previewUrl, activeJob, runProgress]);
  const historyThumbs = useMemo<HistoryThumb[]>(
    () =>
      planeEntries.flatMap((e): HistoryThumb[] =>
        e.kind === 'record'
          ? e.images.map((src, i) => ({ id: tileId(e.key, i), entry: e, index: i, src }))
          : e.kind === 'running'
            ? Array.from({ length: Math.max(1, e.settings.batch_size || 1) }, (_, i) => ({ id: tileId(e.key, i), entry: e, index: i, src: i === 0 ? e.previewUrl : null }))
            : [{ id: tileId(e.key, 0), entry: e, index: 0, src: null }],
      ),
    [planeEntries],
  );
  const recordTileId = selectedRecord ? tileId(selectedRecord.id, Math.min(selectedIndex, Math.max(0, selectedRecord.images.length - 1))) : null;
  const runningSel = planeSel && historyThumbs.some((t) => t.id === planeSel) ? planeSel : null;
  const selectedTileId = runningSel ?? recordTileId;
  /** The finished image the toolbars act on (none while the running job is selected) */
  const actRecord = runningSel ? null : selectedRecord;
  const selectedImageName = selectedRecord ? selectedRecord.images[selectedIndex] ?? selectedRecord.images[0] ?? null : null;
  const parentId = selectedRecord ? selectedRecord.parentId ?? selectedRecord.settings.parentId ?? null : null;
  const parentRecord = parentId ? items.find((i) => i.id === parentId) ?? null : null;

  const pickTile = (entry: PlaneEntry, index: number, focus: boolean) => {
    if (entry.kind === 'record') {
      setPlaneSel(null);
      selectItem(entry.record, index);
    } else {
      setPlaneSel(tileId(entry.key, index));
    }
    if (focus) requestFocus(tileId(entry.key, index));
  };
  const madeFrom =
    actRecord && parentId
      ? {
          kind: derivedKind(actRecord.settings),
          onShow: parentRecord
            ? () => {
                setPlaneSel(null);
                selectItem(parentRecord, 0);
                requestFocus(tileId(parentRecord.id, 0));
              }
            : null,
        }
      : null;
  const downloadImage = (name: string) => {
    const a = document.createElement('a');
    a.href = imageUrl(name);
    a.download = name;
    a.click();
  };
  const copyImageToClipboard = async (name: string) => {
    try {
      const blob = await (await fetch(imageUrl(name))).blob();
      if (!canCopyImages()) {
        flash('Copying images needs a secure connection — use Save instead', 2600);
        return;
      }
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
      flash('Image copied');
    } catch {
      flash('Copy failed — your browser may not allow image copying');
    }
  };
  const copyText = async (text: string, what: string) => {
    try {
      await copyTextToClipboard(text);
      flash(`${what} copied`);
    } catch {
      flash('Copy failed');
    }
  };
  const reusePromptOnly = (r: GenerationRecord) => {
    const st = r.settings;
    setPrompt(st.userPrompt ?? st.promptTemplate ?? st.prompt);
    setNegativePrompt(st.userNegative ?? st.negativeTemplate ?? st.negative_prompt ?? '');
    flash('Prompt loaded');
  };
  const deleteRecords = (ids: string[]) => {
    const list = items.filter((i) => ids.includes(i.id));
    if (!list.length) return;
    if (uiSettings.confirmDelete && !window.confirm(list.length > 1 ? `Delete ${list.length} generations?` : 'Delete this generation?')) return;
    if (selectedId && ids.includes(selectedId)) {
      const rest = items.filter((i) => !ids.includes(i.id) && i.images[0]);
      const idx = items.findIndex((i) => i.id === selectedId);
      const next = rest.find((i) => items.indexOf(i) > idx) ?? rest[rest.length - 1] ?? null;
      if (next) {
        selectItem(next);
        requestFocus(tileId(next.id, 0));
      } else {
        setSelectedId(null);
        setViewImages([]);
      }
    }
    softDelete(list);
  };
  const upscaler = serverSettings.defaultUpscaler && catalog.upscale_models.includes(serverSettings.defaultUpscaler) ? serverSettings.defaultUpscaler : catalog.upscale_models[0] ?? '';
  const upscaleScale = serverSettings.defaultUpscaleScale && serverSettings.defaultUpscaleScale > 1 ? serverSettings.defaultUpscaleScale : 2;
  const canAct = Boolean(actRecord?.images[0]) && readiness.ready && comfyOk !== false;
  const notReadyTip = !actRecord ? 'Select an image first' : comfyOk === false ? 'ComfyUI is offline' : readiness.reason || 'Not ready';
  const useSelectedAs = async (mode: 'img2img' | 'edit' | 'outpaint', msg: string) => {
    if (!actRecord) return;
    if (await setSourceFromGallery(actRecord, selectedIndex)) {
      setWorkMode(mode);
      flash(msg, 2600);
      if (mode === 'edit') window.setTimeout(() => document.getElementById('prompt')?.focus(), 50);
    }
  };
  // ---------- Drop / paste an image ----------
  const applyDrop = async (kind: DropTarget, file: File | null) => {
    setDrop(null);
    if (!file || !file.type.startsWith('image/')) {
      flash('That isn’t an image');
      return;
    }
    const name = file.name || 'Pasted image';
    if (kind === 'reuse') {
      await applyDroppedSettings(file);
      return;
    }
    if (kind === 'cn') {
      try {
        const up = await uploadFileAsSource(file);
        setControlNet((cur) => ({
          ...cur,
          enabled: true,
          image: up.comfyName,
          previewUrl: up.previewUrl,
          name: cur.name || catalog.controlnet[0] || '',
          preprocessor: cur.enabled ? cur.preprocessor : catalog.available.controlnetAux ? 'openpose' : 'none',
          end_percent: cur.enabled ? cur.end_percent : 0.8,
        }));
        flash(`${name} added as the ControlNet guide`, 2400);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Upload failed', 3000);
      }
      return;
    }
    await setSourceFromFile(file);
    flash(`${name} set as the base image`, 2400);
  };
  const dropBlocked = Boolean(maskEditor) || uiSettingsOpen;
  const dropRef = useRef(drop);
  dropRef.current = drop;
  const dragDepth = useRef(0);
  const dropApply = useRef(applyDrop);
  dropApply.current = applyDrop;
  useEffect(() => {
    if (narrow || dropBlocked) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const targetOf = (e: DragEvent): DropTarget | null => {
      const el = (e.target as Element | null)?.closest?.('[data-drop]') as HTMLButtonElement | null;
      return el && !el.disabled ? (el.dataset.drop as DropTarget) : null;
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      if (!dropRef.current) {
        const it = e.dataTransfer?.items?.[0];
        setDrop({ via: 'drop', png: !it || it.type === 'image/png', name: null, over: null, file: null });
      }
    };
    const over = (e: DragEvent) => {
      if (!dropRef.current || dropRef.current.via !== 'drop') return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      const t = targetOf(e);
      if (t !== dropRef.current.over) setDrop({ ...dropRef.current, over: t });
    };
    const leave = () => {
      if (!dropRef.current || dropRef.current.via !== 'drop') return;
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDrop(null);
      }
    };
    const dropped = (e: DragEvent) => {
      if (!dropRef.current) return;
      e.preventDefault();
      dragDepth.current = 0;
      void dropApply.current(targetOf(e) ?? 'base', e.dataTransfer?.files?.[0] ?? null);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', dropped);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', dropped);
    };
  }, [narrow, dropBlocked]);

  // ---------- Inpaint & extend ----------
  // A different base image (or none) makes the saved mask meaningless
  const sourceName = source?.comfyName ?? null;
  useEffect(() => {
    if (!inpaint || inpaint.sourceName === sourceName) return;
    setInpaint(null);
    setOutpaint((o) => ({ ...o, left: 0, right: 0, top: 0, bottom: 0, targetAspect: null }));
    setWorkMode((m) => (m === 'outpaint' ? (sourceName ? 'img2img' : 'generate') : m));
  }, [inpaint, sourceName]);
  const inpaintMasked = Boolean(inpaint && inpaint.coverage > 0);
  const inpaintExtended = Boolean(inpaint && source && (inpaint.W !== source.width || inpaint.H !== source.height));
  const inpaintTitle = inpaintMasked && inpaintExtended ? 'Inpaint & extend' : inpaintExtended ? 'Extend' : 'Inpaint';
  const inpaintSummary = (() => {
    if (!inpaint || !source) return 'Paint a mask or extend the edges';
    const parts: string[] = [];
    if (inpaintMasked) parts.push(`${Math.max(1, Math.round(inpaint.coverage * 100))}% masked`);
    if (inpaintExtended) parts.push(`${source.width}×${source.height} → ${inpaint.W}×${inpaint.H}`);
    return parts.join(' · ') || 'Nothing masked yet';
  })();
  const stopInpainting = () => {
    setInpaint(null);
    setOutpaint((o) => ({ ...o, left: 0, right: 0, top: 0, bottom: 0, targetAspect: null }));
    clearSource();
  };
  const openEditorFor = (rec: GenerationRecord, index: number) => {
    const name = rec.images[index] ?? rec.images[0];
    if (!name) return;
    // Same image as the current mask: continue editing it instead of starting over
    if (inpaint && source && inpaint.sourceName === source.comfyName && inpaint.fromImage === name) {
      setMaskEditor({ src: source.previewUrl });
      return;
    }
    setMaskEditor({ src: imageUrl(name), record: rec, index });
  };
  /** Saved from the editor: make sure the base image is set, upload the mask, switch to inpaint */
  const saveMask = async (r: MaskResult) => {
    const from = maskEditor;
    setMaskEditor(null);
    setSavingMask(true);
    flash('Adding to references…', 8000);
    try {
      await applyMask(r, from);
    } finally {
      setSavingMask(false);
    }
  };
  const applyMask = async (r: MaskResult, from: typeof maskEditor) => {
    let base = source;
    if (from?.record) {
      base = await setSourceFromGallery(from.record, from.index ?? 0);
      if (!base) return;
    }
    if (!base) return;
    let maskName: string | null = null;
    if (r.coverage > 0) {
      try {
        // White-on-black PNG, edges softened a little so the redraw blends in
        const out = document.createElement('canvas');
        out.width = r.mask.width;
        out.height = r.mask.height;
        const ctx = out.getContext('2d')!;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.filter = `blur(${Math.max(4, Math.round(Math.min(out.width, out.height) / 128))}px)`;
        ctx.drawImage(r.mask, 0, 0);
        const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
        if (!blob) throw new Error('Could not save the mask');
        const up = await uploadFileAsSource(new File([blob], `mask-${Date.now()}.png`, { type: 'image/png' }));
        maskName = up.comfyName;
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Mask upload failed', 3000);
        return;
      }
    }
    const extended = r.pad.l + r.pad.r + r.pad.t + r.pad.b > 0;
    setOutpaint((o) => ({ ...o, left: r.pad.l, right: r.pad.r, top: r.pad.t, bottom: r.pad.b, targetAspect: null }));
    const fromImage = from?.record ? from.record.images[from.index ?? 0] ?? null : inpaint?.sourceName === base.comfyName ? inpaint.fromImage : null;
    setInpaint({ sourceName: base.comfyName, fromImage, mask: r.mask, maskName, pad: r.pad, coverage: r.coverage, W: r.srcW + r.pad.l + r.pad.r, H: r.srcH + r.pad.t + r.pad.b });
    setWorkMode('outpaint');
    if (from?.record || imgDenoise < 0.5) setImgDenoise(extended ? 1 : 0.8);
    flash(r.coverage > 0 ? 'Mask saved — Generate to inpaint' : 'Edges set — Generate to extend', 2600);
  };

  const planeActions = {
    enhance: {
      run: () => handleUpscale({ model: upscaler, scale: upscaleScale, refine: true }),
      disabled: !canAct || !upscaler,
      tip: !upscaler ? 'Enhance needs an upscale model — add one in Preferences → Models' : canAct ? `Enhance — upscale ${upscaleScale}× and redraw fine detail` : notReadyTip,
    },
    vary: {
      run: (alt?: boolean) => handleVary(alt ? 'strong' : 'subtle'),
      disabled: !canAct,
      tip: canAct ? 'Vary — a close variation with a new seed  ·  Shift-click for a stronger one' : notReadyTip,
    },
    upscale: {
      run: () => handleUpscale({ model: upscaler, scale: upscaleScale, refine: false }),
      disabled: !canAct || !upscaler,
      tip: !upscaler ? 'Upscale needs an upscale model — add one in Preferences → Models' : canAct ? `Upscale ${upscaleScale}× with ${shortModelName(upscaler)}` : notReadyTip,
    },
    useAsBase: {
      run: () => void useSelectedAs('img2img', 'Set as the base image — see Image to image'),
      disabled: !actRecord || runtime.running,
      tip: actRecord ? 'Use as base image (image to image)' : 'Select an image first',
    },
    edit: {
      run: () => void useSelectedAs('edit', 'Describe the change in the prompt, then Generate'),
      disabled: !actRecord || runtime.running || !familyMeta?.supportsEdit,
      tip: !familyMeta?.supportsEdit ? 'Edit by instruction needs an edit model (e.g. Flux Kontext)' : 'Edit image — describe the change in the prompt',
    },
    inpaint: {
      run: () => actRecord && openEditorFor(actRecord, selectedIndex),
      disabled: !actRecord || runtime.running || savingMask,
      tip: 'Inpaint / extend — paint a mask, or drag the edges out',
    },
  };
  const ctxRecord = ctxMenu ? items.find((i) => i.id === ctxMenu.recordId) ?? null : null;
  const ctxItems: CtxItem[] = ctxRecord && ctxMenu
    ? [
        { label: 'Reuse prompt', onClick: () => reusePromptOnly(ctxRecord) },
        { label: 'Reuse all settings', onClick: () => reuseSettings(ctxRecord) },
        { label: 'Copy prompt', onClick: () => void copyText(ctxRecord.settings.userPrompt ?? ctxRecord.settings.prompt, 'Prompt') },
        {
          label: 'Show details',
          hint: 'I',
          onClick: () => {
            selectItem(ctxRecord, ctxMenu.index);
            setDetailsOpen(true);
          },
        },
        'sep',
        {
          label: 'Use as base image',
          disabled: runtime.running,
          onClick: () => {
            selectItem(ctxRecord, ctxMenu.index);
            void setSourceFromGallery(ctxRecord, ctxMenu.index).then((ok) => ok && flash('Set as the base image — see Image to image', 2600));
          },
        },
        { label: 'Inpaint or extend…', disabled: runtime.running || savingMask, onClick: () => openEditorFor(ctxRecord, ctxMenu.index) },
        { label: favorites.has(ctxRecord.id) ? 'Unpin' : 'Pin', hint: 'F', onClick: () => toggleFavorite(ctxRecord) },
        { label: 'Copy image', onClick: () => void copyImageToClipboard(ctxRecord.images[ctxMenu.index] ?? ctxRecord.images[0]) },
        { label: 'Download PNG', onClick: () => downloadImage(ctxRecord.images[ctxMenu.index] ?? ctxRecord.images[0]) },
        'sep',
        { label: 'Delete', hint: 'Del', danger: true, onClick: () => deleteRecords([ctxRecord.id]) },
      ]
    : [];

  // Studio keys: arrows walk the shown images, I toggles details, Delete removes
  const studioKeys = useRef<(e: KeyboardEvent) => void>(() => {});
  studioKeys.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey || uiSettingsOpen || document.querySelector('[role="menu"], [role="dialog"]')) return;
    const list = historyThumbs.filter((x) => x.entry.kind !== 'failed');
    const at = list.findIndex((x) => x.id === selectedTileId);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!list.length) return;
      e.preventDefault();
      let next = at;
      if (e.key === 'ArrowLeft') next = Math.max(0, at - 1);
      else if (e.key === 'ArrowRight') next = at < 0 ? 0 : Math.min(list.length - 1, at + 1);
      else {
        // Up/Down jump a whole generation
        const cur = list[at]?.entry.key;
        const keys = [...new Set(list.map((x) => x.entry.key))];
        const ki = cur ? keys.indexOf(cur) : -1;
        const nk = keys[e.key === 'ArrowUp' ? Math.max(0, ki - 1) : Math.min(keys.length - 1, ki + 1)];
        next = list.findIndex((x) => x.entry.key === nk);
      }
      const n = list[next];
      if (n) pickTile(n.entry, n.index, true);
    } else if (e.key.toLowerCase() === 'i') {
      setDetailsOpen((o) => !o);
    } else if (e.key === 'Escape' && detailsOpen && !runtime.running) {
      setDetailsOpen(false);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && actRecord) {
      e.preventDefault();
      deleteRecords([actRecord.id]);
    }
  };
  useEffect(() => {
    if (narrow) return;
    const onKey = (e: KeyboardEvent) => studioKeys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [narrow]);

  // A job starting: select and show its tile (Preferences → Jump to newest)
  const lastActive = useRef<string | null>(null);
  useEffect(() => {
    if (!activeQueueId || activeQueueId === lastActive.current) return;
    lastActive.current = activeQueueId;
    if (!uiSettings.jumpToNewest) return;
    setPlaneSel('running:0');
    requestFocus('running:0');
  }, [activeQueueId, narrow, requestFocus, uiSettings.jumpToNewest]);

  const planeToast = pendingDelete
    ? {
        text: pendingDelete.length > 1 ? `${pendingDelete.length} generations deleted` : 'Deleted',
        action: {
          label: 'Undo',
          run: () => {
            const restored = undoDelete()[0];
            if (restored) {
              selectItem(restored);
              requestFocus(tileId(restored.id, 0));
            }
          },
        },
      }
    : copyFlash
      ? { text: copyFlash }
      : null;

  const planeOverlay =
    items.length === 0 && !histLoading && !runtime.running && failedJobs.length === 0 ? (
      <Onboarding
        comfyOk={comfyOk}
        systemLabel={systemStats?.ok ? systemStats.label : null}
        remote={remoteMode}
        starting={startingComfy}
        onStartComfy={() => void handleStartComfy()}
        modelName={readiness.nothingInstalled || !primaryModel ? null : shortModelName(primaryModel.replace(/\.(safetensors|ckpt|gguf|pt)$/i, ''))}
        onAddModel={() => openAddModel()}
        onExample={() => setPrompt(randomPrompt(resolved.tagsEnabled))}
      />
    ) : planeEntries.length === 0 && !histLoading && (histQuery || histModel !== 'all' || pinnedOnly) ? (
      <div className="st-hint">
        <span className="text-[15px] font-semibold" style={{ color: 'var(--s-text)' }}>No images match</span>
        <button type="button" className="st-pill mt-2" onClick={() => { setHistQuery(''); setHistModel('all'); setPinnedOnly(false); }}>Clear filters</button>
      </div>
    ) : null;

  const studioPlane = (
    <ImagePlane
      entries={planeEntries}
      selectedId={selectedTileId}
      onSelect={(t: Tile) => pickTile(t.entry, t.index, t.entry.kind === 'failed')}
      focus={planeFocus}
      onContext={(t, x, y) => {
        if (t.entry.kind !== 'record') return;
        selectItem(t.entry.record, t.index);
        setCtxMenu({ x, y, recordId: t.entry.record.id, index: t.index });
      }}
      actions={planeActions}
      info={
        actRecord && selectedImageName
          ? {
              seed: actRecord.settings.seed ?? null,
              pinned: favorites.has(actRecord.id),
              onPin: () => toggleFavorite(actRecord),
              onCopyImage: () => void copyImageToClipboard(selectedImageName),
              onDownload: () => downloadImage(selectedImageName),
              onCopySeed: () => void copyText(String(actRecord.settings.seed), 'Seed'),
            }
          : null
      }
      compare={parentRecord?.images[0] && actRecord ? { src: imageUrl(parentRecord.images[0]), kind: derivedKind(actRecord.settings) } : null}
      failedActions={{
        retry: (f) => {
          setFailedJobs((prev) => prev.filter((x) => x.id !== f.id));
          enqueueJob(f.settings, f.label);
        },
        dismiss: (f) => setFailedJobs((prev) => prev.filter((x) => x.id !== f.id)),
        copy: (f) => void copyText(`${f.label}\n\n${f.error}`, 'Error'),
      }}
      progress={runProgress}
      toast={planeToast}
      background={uiSettings.canvasBackground}
      overlay={planeOverlay}
    />
  );

  const studioHistory = (
    <HistoryPanel
      thumbs={historyThumbs}
      total={items.reduce((a, r) => a + r.images.length, 0)}
      selectedId={selectedTileId}
      onPick={(t) => pickTile(t.entry, t.index, true)}
      onContext={(t, x, y) => {
        if (t.entry.kind !== 'record') return;
        selectItem(t.entry.record, t.index);
        setCtxMenu({ x, y, recordId: t.entry.record.id, index: t.index });
      }}
      isPinned={(id) => favorites.has(id)}
      query={histQuery}
      onQuery={setHistQuery}
      models={histModels}
      model={histModel}
      onModel={setHistModel}
      pinnedOnly={pinnedOnly}
      onPinnedOnly={setPinnedOnly}
      pinnedCount={items.filter((i) => favorites.has(i.id)).reduce((a, r) => a + r.images.length, 0)}
      onDownload={(list) => {
        const files = list
          .filter((t) => t.entry.kind === 'record')
          .map((t) => (t.entry.kind === 'record' ? t.entry.record.images[t.index] : ''))
          .filter(Boolean);
        if (files.length === 1) {
          downloadImage(files[0]);
          return;
        }
        flash(`Preparing ${files.length} images…`, 4000);
        void downloadZip(
          files.map((f) => ({ url: imageUrl(f), name: f })),
          `darkroom-${new Date().toISOString().slice(0, 10)}.zip`,
        )
          .then(() => flash('Download ready'))
          .catch(() => flash('Download failed'));
      }}
      onDelete={deleteRecords}
      onPin={(ids, pin) =>
        setFavorites((prev) => {
          const next = new Set(prev);
          for (const id of ids) {
            if (pin) next.add(id);
            else next.delete(id);
          }
          return next;
        })
      }
      loading={histLoading}
    />
  );


  // ---------- Phone ----------
  const phoneTile: ViewerTile | null = (() => {
    const t = historyThumbs.find((x) => x.id === selectedTileId);
    if (!t) return null;
    const e = t.entry;
    if (e.kind === 'record') return { kind: 'record', src: t.src, ...outputSize(e.record.settings) };
    if (e.kind === 'running') return { kind: 'running', src: t.src, ...outputSize(e.settings), progress: e.progress };
    return { kind: 'failed', src: null, ...outputSize(e.failed.settings), failed: e.failed };
  })();
  const phoneStep = (dir: 1 | -1) => {
    const at = historyThumbs.findIndex((t) => t.id === selectedTileId);
    const next = historyThumbs[at + dir];
    if (next) pickTile(next.entry, next.index, false);
  };
  const openPhoneActions = (recordId: string, index: number) => {
    setCtxMenu({ x: 0, y: 0, recordId, index });
    setPhoneSheet('actions');
  };
  const closePhoneSheet = () => {
    setPhoneSheet(null);
    setCtxMenu(null);
  };
  const phoneTools: Array<{ label: string; icon: ReactNode; run: () => void; disabled?: boolean; on?: boolean }> = [
    { label: 'Enhance', icon: <EnhanceIcon />, run: () => planeActions.enhance.run(), disabled: planeActions.enhance.disabled },
    { label: 'Variation', icon: <VaryIcon />, run: () => planeActions.vary.run(), disabled: planeActions.vary.disabled },
    { label: `Upscale ${upscaleScale}×`, icon: <UpscaleIcon />, run: () => planeActions.upscale.run(), disabled: planeActions.upscale.disabled },
    { label: 'Use as base', icon: <UseAsBaseIcon />, run: () => planeActions.useAsBase.run(), disabled: planeActions.useAsBase.disabled },
    { label: 'Edit', icon: <EditIcon />, run: () => planeActions.edit.run(), disabled: planeActions.edit.disabled },
    { label: 'Inpaint', icon: <InpaintIcon />, run: () => planeActions.inpaint.run(), disabled: planeActions.inpaint.disabled },
    {
      label: actRecord && favorites.has(actRecord.id) ? 'Unpin' : 'Pin',
      icon: <PinIcon filled={Boolean(actRecord && favorites.has(actRecord.id))} />,
      run: () => actRecord && toggleFavorite(actRecord),
      disabled: !actRecord,
      on: Boolean(actRecord && favorites.has(actRecord.id)),
    },
    { label: 'Copy image', icon: <CopyImageIcon />, run: () => selectedImageName && void copyImageToClipboard(selectedImageName), disabled: !actRecord },
    { label: 'Save', icon: <DownloadIcon />, run: () => selectedImageName && downloadImage(selectedImageName), disabled: !actRecord },
    ...(parentRecord && actRecord
      ? [{ label: phoneCompare ? 'Hide compare' : 'Compare', icon: <CompareIcon />, run: () => setPhoneCompare((c) => !c), on: phoneCompare }]
      : []),
  ];
  const phoneSheetNode =
    phoneSheet === 'tools' ? (
      <PhoneSheet title="Tools" onClose={closePhoneSheet}>
        <div className="st-sec px-1.5">Model</div>
        {catalog.checkpoints.map((c) => (
          <button
            key={c}
            type="button"
            className={`st-rowbtn ${modelMode === 'checkpoint' && checkpoint === c ? 'on' : ''}`}
            disabled={runtime.running}
            onClick={() => {
              setModelMode('checkpoint');
              setCheckpoint(c);
              setStyleId(null);
              setDismissedPositive([]);
              setDismissedNegative([]);
              prevFamily.current = null;
              closePhoneSheet();
            }}
          >
            <span className="flex min-w-0 flex-col gap-px">
              <span className="truncate text-[15px] font-semibold">{shortModelName(c.replace(/\.(safetensors|ckpt|gguf)$/i, ''))}</span>
              {modelMode === 'checkpoint' && checkpoint === c && resolved.familyName ? (
                <span className="text-[12.5px]" style={{ color: 'var(--s-muted)' }}>{resolved.familyName}</span>
              ) : null}
            </span>
          </button>
        ))}
        <button type="button" className="st-rowbtn" onClick={() => setPhoneSheet('models')}>
          <span className="text-[14px]" style={{ color: 'var(--s-accent)' }}>
            {modelMode === 'split' ? `${shortModelName(unet)} · more model options…` : 'More model options (Flux, split files, add a model)…'}
          </span>
        </button>
        {styles.length ? (
          <>
            <div className="st-sec px-1.5 pt-1.5">Style</div>
            <div className="flex flex-wrap gap-1.5 px-1">
              {styles.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  className={`st-pill h-9 ${st.id === activeStyleId ? 'st-pill-accent' : ''}`}
                  disabled={runtime.running}
                  onClick={() => {
                    setStyleId(st.id);
                    setDismissedPositive([]);
                    setDismissedNegative([]);
                  }}
                >
                  {st.name}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <div className="st-sec px-1.5 pt-1.5">This image</div>
        <div className="grid grid-cols-3 gap-2">
          {phoneTools.map((t) => (
            <button
              key={t.label}
              type="button"
              className={`st-tilebtn ${t.on ? 'on' : ''}`}
              disabled={t.disabled}
              onClick={() => {
                t.run();
                if (!t.label.startsWith('Pin') && !t.label.startsWith('Unpin') && !t.label.includes('ompare')) closePhoneSheet();
              }}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
          <button type="button" className="st-tilebtn" disabled={!actRecord} onClick={() => setPhoneSheet('details')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v6M12 7.5v.5" />
            </svg>
            <span>Details</span>
          </button>
        </div>
      </PhoneSheet>
    ) : phoneSheet === 'models' ? (
      <PhoneSheet title="Model" onClose={closePhoneSheet}>
        <div className="flex flex-col gap-3 px-1">{modelPanel}</div>
      </PhoneSheet>
    ) : phoneSheet === 'panel' ? (
      <PhoneSheet title="Prompt" onClose={closePhoneSheet}>
        <PromptPopout
          inline
          prompt={prompt}
          onInsert={(text, mode) => {
            insertIntoPrompt(text, mode);
            closePhoneSheet();
          }}
          embeddings={catalog.embeddings}
          prefs={promptPrefs}
          onPrefs={setPromptPrefs}
          onClose={closePhoneSheet}
        />
      </PhoneSheet>
    ) : phoneSheet === 'loraPick' ? (
      <PhoneSheet title="Add a LoRA" onClose={closePhoneSheet}>
        <LoraPicker
          inline
          {...loraContext}
          options={catalog.loras}
          loras={loras}
          loading={modelsLoading}
          onAdd={(name) => setLoras((prev) => (prev.some((l) => l.name === name) ? prev : [...prev, { name, strength_model: 1, strength_clip: 1, enabled: true }]))}
          onAddModel={() => {
            closePhoneSheet();
            openAddModel('lora');
          }}
          onClose={closePhoneSheet}
        />
      </PhoneSheet>
    ) : phoneSheet === 'details' && actRecord ? (
      <PhoneSheet title="Details" onClose={closePhoneSheet}>
        <DetailsPanel
          inline
          record={actRecord}
          madeFrom={madeFrom}
          size={outputSize(actRecord.settings)}
          onClose={closePhoneSheet}
          onCopy={(text, what) => void copyText(text, what)}
          onReuseAll={() => {
            reuseSettings(actRecord);
            closePhoneSheet();
          }}
          onReusePrompt={() => {
            reusePromptOnly(actRecord);
            closePhoneSheet();
          }}
        />
      </PhoneSheet>
    ) : phoneSheet === 'actions' && ctxItems.length ? (
      <PhoneSheet title="This image" onClose={closePhoneSheet}>
        {ctxItems.map((it, i) =>
          it === 'sep' ? (
            <div key={`sep-${i}`} className="mx-2 h-px" style={{ background: 'var(--s-line)' }} />
          ) : (
            <button
              key={it.label}
              type="button"
              className="st-rowbtn"
              disabled={it.disabled}
              style={{ color: it.danger ? '#f0857f' : undefined }}
              onClick={() => {
                const run = it.label === 'Show details' ? () => setPhoneSheet('details') : it.onClick;
                if (it.label !== 'Show details') closePhoneSheet();
                run();
              }}
            >
              <span className="text-[15.5px]">{it.label === 'Download PNG' ? 'Save image' : it.label}</span>
            </button>
          ),
        )}
      </PhoneSheet>
    ) : null;


  const studio = !narrow;
  const phoneStudio = narrow;

  return (
    <>
      {studio ? (
        <StudioShell
          controls={renderStudioControls()}
          stage={studioPlane}
          history={studioHistory}
          historyCount={items.reduce((a, r) => a + r.images.length, 0)}
          reconnecting={reconnecting}
          serverDown={serverDown}
          overlay={
            drop ? (
              <DropDialog
                via={drop.via}
                name={drop.name}
                png={drop.png}
                over={drop.over}
                guideAvailable={Boolean(catalog.available.controlnet)}
                onPick={(t) => void applyDrop(t, drop.file)}
                onCancel={() => setDrop(null)}
              />
            ) : maskEditor ? (
              <MaskEditor
                key={maskEditor.src}
                src={maskEditor.src}
                initialMask={!maskEditor.record && inpaint?.sourceName === source?.comfyName ? inpaint?.mask ?? null : null}
                initialPad={!maskEditor.record && inpaint?.sourceName === source?.comfyName ? inpaint?.pad : undefined}
                saveLabel={!maskEditor.record && inpaint?.sourceName === source?.comfyName ? 'Update reference' : 'Add to references'}
                onSave={(r) => void saveMask(r)}
                onClose={() => setMaskEditor(null)}
              />
            ) : null
          }
          details={
            detailsOpen ? (
              <DetailsPanel
                record={actRecord}
                size={actRecord ? outputSize(actRecord.settings) : null}
                onClose={() => setDetailsOpen(false)}
                onCopy={(text, what) => void copyText(text, what)}
                onReuseAll={() => actRecord && reuseSettings(actRecord)}
                onReusePrompt={() => actRecord && reusePromptOnly(actRecord)}
                madeFrom={madeFrom}
              />
            ) : null
          }
          comfyOk={comfyOk}
          systemLabel={systemStats?.ok ? systemStats.label : null}
          vramTooltip={systemStats?.vramTooltip}
          running={runtime.running}
          progressLabel={
            runtime.running && runtime.progressMax
              ? `Step ${runtime.progressStep} / ${runtime.progressMax} · ${Math.round((runtime.progressStep / runtime.progressMax) * 100)}%`
              : null
          }
          onGenerate={() => void handleGenerate()}
          ui={uiSettings}
          onUiPatch={updateUiSettings}
          prefsOpen={uiSettingsOpen}
          onPrefsOpenChange={setUiSettingsOpen}
          preferences={preferenceProps}
        />
      ) : phoneStudio ? (
        <PhoneShell
          modelName={primaryModel ? shortModelName(primaryModel.replace(/\.(safetensors|ckpt|gguf)$/i, '')) : 'No model'}
          status={
            comfyOk === null
              ? { dot: 'var(--s-faint)', tip: 'Checking the ComfyUI connection' }
              : serverDown
                ? { dot: '#e5534b', tip: 'The Darkroom server isn’t answering — it may be restarting' }
                : comfyOk
                  ? { dot: '#5bd18b', tip: systemStats?.ok ? `ComfyUI connected · ${systemStats.label}` : 'ComfyUI connected' }
                  : { dot: reconnecting ? '#e2b44f' : '#e5534b', tip: reconnecting ? 'Reconnecting to ComfyUI…' : 'ComfyUI offline' }
          }
          toolsOpen={phoneSheet === 'tools'}
          onTools={() => setPhoneSheet((s) => (s === 'tools' ? null : 'tools'))}
          prefsOpen={uiSettingsOpen}
          onPrefsOpenChange={setUiSettingsOpen}
          preferences={preferenceProps}
          viewer={
            <PhoneViewer
              tile={phoneTile}
              compare={parentRecord?.images[0] && actRecord ? { src: imageUrl(parentRecord.images[0]), kind: derivedKind(actRecord.settings) } : null}
              compareOn={phoneCompare}
              progress={runProgress}
              toast={planeToast}
              failedActions={{
                retry: (f) => {
                  setFailedJobs((prev) => prev.filter((x) => x.id !== f.id));
                  setPlaneSel(null);
                  enqueueJob(f.settings, f.label);
                },
                dismiss: (f) => {
                  setFailedJobs((prev) => prev.filter((x) => x.id !== f.id));
                  setPlaneSel(null);
                },
                copy: (f) => void copyText(`${f.label}\n\n${f.error}`, 'Error'),
              }}
              onLongPress={() => actRecord && openPhoneActions(actRecord.id, selectedIndex)}
              onSwipe={phoneStep}
              onTap={() => phoneTile?.src && phoneTile.kind !== 'failed' && setPhoneFull(true)}
              empty={planeOverlay}
            />
          }
          thumbs={
            <PhoneThumbs
              thumbs={historyThumbs}
              selectedId={selectedTileId}
              onPick={(t) => pickTile(t.entry, t.index, false)}
              onLongPress={(t) => {
                if (t.entry.kind !== 'record') return;
                selectItem(t.entry.record, t.index);
                openPhoneActions(t.entry.record.id, t.index);
              }}
              isPinned={(id) => favorites.has(id)}
            />
          }
          controls={renderStudioControls('phone')}
          sheet={phoneSheetNode}
          overlay={
            phoneFull && phoneTile?.src && !maskEditor ? (
              <FullscreenImage
                src={phoneTile.src}
                counter={`${historyThumbs.findIndex((t) => t.id === selectedTileId) + 1} / ${historyThumbs.length}`}
                onClose={() => setPhoneFull(false)}
                onSwipe={phoneStep}
              />
            ) : maskEditor ? (
              <MaskEditor
                key={maskEditor.src}
                compact
                src={maskEditor.src}
                initialMask={!maskEditor.record && inpaint?.sourceName === source?.comfyName ? inpaint?.mask ?? null : null}
                initialPad={!maskEditor.record && inpaint?.sourceName === source?.comfyName ? inpaint?.pad : undefined}
                saveLabel={!maskEditor.record && inpaint?.sourceName === source?.comfyName ? 'Update' : 'Add'}
                onSave={(r) => void saveMask(r)}
                onClose={() => setMaskEditor(null)}
              />
            ) : null
          }
        />
      ) : null}
      {studio && ctxMenu && ctxItems.length ? <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems} onClose={() => setCtxMenu(null)} /> : null}
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
          setResolved({ ...emptyResolved, ...next });
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
                setResolved({ ...emptyResolved, ...next });
              });
            }
          });
        }}
      />
    </>
  );
}
