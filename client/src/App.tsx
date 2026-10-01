import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdvancedSettings } from '@/components/controls/AdvancedSettings';
import { AspectRatioPresets } from '@/components/controls/AspectRatioPresets';
import { BatchControl } from '@/components/controls/BatchControl';
import { CheckpointSelect } from '@/components/controls/CheckpointSelect';
import { FamilyBadge } from '@/components/controls/FamilyBadge';
import { FinalPromptPreview } from '@/components/controls/FinalPromptPreview';
import { GenerateButton } from '@/components/controls/GenerateButton';
import { MapFamilyDialog } from '@/components/controls/MapFamilyDialog';
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
import { UiSettingsPanel } from '@/components/settings/UiSettingsPanel';
import { Separator } from '@/components/ui/separator';
import { scaleAspectPresets } from '@/constants/aspectRatios';
import { useCheckpoints } from '@/hooks/useCheckpoints';
import { useFamilies } from '@/hooks/useFamilies';
import { useGeneration } from '@/hooks/useGeneration';
import { useHistory } from '@/hooks/useHistory';
import { useUiSettings } from '@/hooks/useUiSettings';
import {
  fetchHealth,
  fetchPreviewSettings,
  mapCheckpointFamily,
  resolvePresetsApi,
  updatePreviewQuality,
} from '@/lib/api';
import { qualityToPreviewMethod } from '@/lib/uiSettings';
import type { GenerationRecord, GenerationSettings } from '@/types/generation';
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
  const { checkpoints, loading: ckptLoading, error: ckptError, reload: reloadCheckpoints } =
    useCheckpoints();
  const { families } = useFamilies();
  const { items, loading: histLoading, reload, remove } = useHistory();
  const [comfyOk, setComfyOk] = useState<boolean | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uiSettingsOpen, setUiSettingsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [finalOpen, setFinalOpen] = useState(false);
  const [perPromptPreview, setPerPromptPreview] = useState<boolean | null>(null);

  const { settings: uiSettings, setLivePreview, setPreviewQuality } = useUiSettings();

  const [styleId, setStyleId] = useState<string | null>(null);
  const [dismissedPositive, setDismissedPositive] = useState<string[]>([]);
  const [dismissedNegative, setDismissedNegative] = useState<string[]>([]);
  const [resolved, setResolved] = useState<ResolvedPresets>(emptyResolved);

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [checkpoint, setCheckpoint] = useState('');
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

  const familyMeta = useMemo(
    () => families.find((f) => f.id === resolved.familyId) ?? null,
    [families, resolved.familyId],
  );

  const styles = familyMeta?.styles ?? [];

  // Keep checkpoint valid
  useEffect(() => {
    if (checkpoints.length === 0) {
      setCheckpoint('');
      return;
    }
    if (!checkpoint || !checkpoints.includes(checkpoint)) {
      setCheckpoint(checkpoints[0]);
    }
  }, [checkpoints, checkpoint]);

  // Resolve presets whenever inputs change
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!checkpoint) {
        setResolved(emptyResolved);
        return;
      }
      try {
        const next = await resolvePresetsApi({
          checkpoint,
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
  }, [checkpoint, styleId, dismissedPositive, dismissedNegative, prompt, negativePrompt]);

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
          if (h.comfy) void reloadCheckpoints();
        }
      } catch {
        if (!cancelled) setComfyOk(false);
      }
    };
    void check();
    const id = window.setInterval(check, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [reloadCheckpoints]);

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
      setSelectedId(record.id);
      setViewImages(record.images);
      setSettingsOpen(false);
    },
    [reload],
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

  const canGenerate =
    Boolean(checkpoint) &&
    Boolean(resolved.finalPositive.trim()) &&
    resolved.mapped &&
    comfyOk !== false &&
    !runtime.running;

  const handleGenerate = useCallback(async () => {
    if (!canGenerate || !checkpoint) return;
    const nextSeed = seedLocked ? seed : randomSeed();
    if (!seedLocked) setSeed(nextSeed);

    const s = resolved.settings;
    const settings: GenerationSettings = {
      prompt: resolved.finalPositive,
      negative_prompt: resolved.finalNegative,
      checkpoint,
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
    };

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
  }, [
    batchSize,
    canGenerate,
    cfg,
    checkpoint,
    clipSkip,
    generate,
    guidance,
    height,
    perPromptPreview,
    resolved,
    sampler,
    scheduler,
    seed,
    seedLocked,
    steps,
    uiSettings.livePreview,
    uiSettings.previewQuality,
    width,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleGenerate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleGenerate]);

  const reuseSettings = (item: GenerationRecord) => {
    const s = item.settings;
    setPrompt(s.prompt);
    setNegativePrompt(s.negative_prompt);
    setCheckpoint(s.checkpoint);
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
    void remove(activeRecord.id).then(() => {
      if (selectedId === activeRecord.id) {
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
    onSelect: selectItem,
    onReuse: reuseSettings,
    onDelete: (item: GenerationRecord) => {
      void remove(item.id).then(() => {
        if (selectedId === item.id) {
          setSelectedId(null);
          setViewImages([]);
        }
      });
    },
    loading: histLoading,
  };

  const showMapDialog = Boolean(checkpoint) && !resolved.mapped && families.length > 0;

  const renderSettings = () => (
    <SettingsPanel
      footer={
        <div className="space-y-2">
          <GenerateButton
            onGenerate={() => void handleGenerate()}
            onCancel={() => void cancel()}
            running={runtime.running}
            progress={runtime.progress}
            progressStep={runtime.progressStep}
            progressMax={runtime.progressMax}
            disabled={!canGenerate}
          />
          {runtime.error && <p className="text-xs text-destructive">{runtime.error}</p>}
        </div>
      }
    >
      <CheckpointSelect
        checkpoints={checkpoints}
        value={checkpoint}
        onChange={(v) => {
          setCheckpoint(v);
          setStyleId(null);
          setDismissedPositive([]);
          setDismissedNegative([]);
          prevFamily.current = null;
        }}
        loading={ckptLoading}
        error={
          comfyOk === false
            ? 'ComfyUI offline — start it on :8188 (checkpoints load from /object_info)'
            : ckptError
        }
        disabled={runtime.running}
      />
      <FamilyBadge
        familyName={resolved.familyName}
        mapped={resolved.mapped}
        baseRes={resolved.settings.baseRes}
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
      />
      <Separator />
      <PromptPanel
        prompt={prompt}
        negativePrompt={negativePrompt}
        positiveTags={resolved.positiveTags}
        negativeTags={resolved.negativeTags}
        disableNegative={resolved.disableNegative}
        familyId={resolved.familyId}
        tagsEnabled={resolved.tagsEnabled}
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
        checkpoint={checkpoint}
      />
      <AspectRatioPresets
        presets={resolved.aspectPresets}
        width={width}
        height={height}
        onChange={(w, h) => {
          setWidth(w);
          setHeight(h);
          const hit = resolved.aspectPresets.find((p) => p.width === w && p.height === h);
          if (hit) setAspectId(hit.id);
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
      <Separator />
      <AdvancedSettings open={advancedOpen} onOpenChange={setAdvancedOpen}>
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
    </SettingsPanel>
  );

  return (
    <>
      <AppShell
        comfyOk={comfyOk}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
        uiSettingsOpen={uiSettingsOpen}
        onUiSettingsOpenChange={setUiSettingsOpen}
        settings={renderSettings()}
        settingsDrawer={renderSettings()}
        uiSettings={
          <UiSettingsPanel
            settings={uiSettings}
            onLivePreviewChange={handleLivePreviewChange}
            onPreviewQualityChange={(q) => void handlePreviewQualityChange(q)}
            perPromptPreview={perPromptPreview}
          />
        }
        stage={
          <MainStage>
            <div className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1">
                <PreviewCanvas
                  previewUrl={runtime.previewUrl}
                  resultImages={displayImages}
                  running={runtime.running}
                  width={width}
                  height={height}
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
        checkpoint={checkpoint}
        families={families}
        onSave={async (family) => {
          await mapCheckpointFamily(checkpoint, family);
          prevFamily.current = null;
          // Force resolve refresh
          setStyleId(null);
          setDismissedPositive([]);
          setDismissedNegative([]);
          const next = await resolvePresetsApi({
            checkpoint,
            styleId: null,
            dismissedPositive: [],
            dismissedNegative: [],
            userPositive: prompt,
            userNegative: negativePrompt,
          });
          setResolved(next);
          if (next.styleId) setStyleId(next.styleId);
        }}
      />
    </>
  );
}
