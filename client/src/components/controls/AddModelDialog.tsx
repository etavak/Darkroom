import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DependencyResolver } from '@/components/controls/DependencyResolver';
import {
  confirmModelInstallApi,
  detectModelPathApi,
  fetchModelJob,
  fetchModelTypes,
  fetchSystemStats,
  apiKeyProblem,
  resolveModelUrlApi,
  saveDownloadTokens,
  startModelDownloadApi,
  uploadModelFileApi,
} from '@/lib/api';
import type { ModelInstallJob } from '@/types/generation';

/** Which site's key a download error asks for (the server names the site in its message). */
function keyNeededFor(message: string | null): 'civitai' | 'huggingface' | null {
  if (!message || !/HTTP 40[13]/.test(message)) return null;
  if (/civitai/i.test(message)) return 'civitai';
  if (/hugging ?face/i.test(message)) return 'huggingface';
  return null;
}

const KEY_HELP = {
  civitai: { name: 'Civitai API key', where: 'civitai.com → Account settings → API keys', placeholder: 'Paste your Civitai key' },
  huggingface: { name: 'Hugging Face token', where: 'huggingface.co → Settings → Access tokens (accept the model’s licence first)', placeholder: 'hf_…' },
} as const;
import type { FamilySummary } from '@/types/presets';

type Props = {
  open: boolean;
  onClose: () => void;
  onInstalled: (info: { filename: string; type: string; family?: string }) => void;
  families: FamilySummary[];
  preferType?: string;
};

type InstallMode = 'copy' | 'move' | 'link';

export function AddModelDialog({ open, onClose, onInstalled, families, preferType }: Props) {
  const [url, setUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [types, setTypes] = useState<Array<{ value: string; label: string }>>([]);
  const [job, setJob] = useState<ModelInstallJob | null>(null);
  const [type, setType] = useState(preferType || 'checkpoint');
  const [family, setFamily] = useState('');
  const [candidate, setCandidate] = useState('');
  const [mode, setMode] = useState<InstallMode>('copy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depPhase, setDepPhase] = useState(false);
  const [vramTotal, setVramTotal] = useState<number | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [keySaving, setKeySaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetchModelTypes()
      .then((r) => setTypes(r.types))
      .catch(() =>
        setTypes([
          { value: 'checkpoint', label: 'Checkpoint' },
          { value: 'diffusion', label: 'Diffusion model' },
          { value: 'text_encoder', label: 'Text encoder' },
          { value: 'vae', label: 'VAE' },
          { value: 'lora', label: 'LoRA' },
          { value: 'upscaler', label: 'Upscaler' },
          { value: 'controlnet', label: 'ControlNet' },
        ]),
      );
    void fetchSystemStats()
      .then((s) => setVramTotal(s.vramTotal))
      .catch(() => setVramTotal(null));
    if (preferType) setType(preferType);
  }, [open, preferType]);

  useEffect(() => {
    if (!job || (job.status !== 'downloading' && job.status !== 'installing')) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    pollRef.current = window.setInterval(() => {
      void fetchModelJob(job.id).then((next) => {
        setJob(next);
        if (next.guessedType && next.status === 'ready') {
          setType(next.guessedType === 'unknown' ? type : next.guessedType);
        }
        if (next.status === 'error') setError(next.error || 'Failed');
      });
    }, 400);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [job, type]);

  useEffect(() => {
    if (!job) return;
    if (job.defaultMode) setMode(job.defaultMode);
    else if (job.allowLink) setMode('link');
    else if (job.modelName || job.downloadUrl) setMode('move');
    else setMode('copy');
  }, [job?.id, job?.defaultMode, job?.allowLink, job?.modelName, job?.downloadUrl]);

  if (!open) return null;

  const needsFamily = type === 'checkpoint' || type === 'diffusion';
  const isGguf = /\.gguf$/i.test(job?.filename || '');
  const familyOptions = families.filter((f) => {
    if (!isGguf) return true;
    return f.supportsGguf || f.id === 'flux' || f.id === 'sd3';
  });
  const canLink = Boolean(job?.allowLink || job?.localPath);

  const reset = () => {
    setUrl('');
    setLocalPath('');
    setJob(null);
    setError(null);
    setBusy(false);
    setCandidate('');
    setFamily('');
    setMode('copy');
    setDepPhase(false);
  };

  const finishAndClose = () => {
    reset();
    onClose();
  };

  const handleResolve = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await resolveModelUrlApi(url.trim());
      setJob(next);
      if (next.error) setError(next.error);
      if (next.candidates?.[0]) setCandidate(next.candidates[0].path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resolve failed');
    } finally {
      setBusy(false);
    }
  };

  const keyNeeded = keyNeededFor(error);
  /** Save the key, then try the same step again (download if it got that far, else resolve) */
  const saveKeyAndRetry = async () => {
    if (!keyNeeded || !keyDraft.trim() || apiKeyProblem(keyDraft)) return;
    setKeySaving(true);
    try {
      await saveDownloadTokens({ [keyNeeded]: keyDraft.trim() });
      setKeyDraft('');
      if (job?.downloadUrl || job?.candidates?.length) await handleDownload();
      else await handleResolve();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the key');
    } finally {
      setKeySaving(false);
    }
  };

  const handleDownload = async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const next = await startModelDownloadApi(job.id, candidate || undefined);
      setJob(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const next = await uploadModelFileApi(file);
      setJob(next);
      if (next.guessedType && next.guessedType !== 'unknown') setType(next.guessedType);
      if (next.error) setError(next.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleLocalPath = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await detectModelPathApi(localPath.trim());
      setJob(next);
      if (next.guessedType && next.guessedType !== 'unknown') setType(next.guessedType);
      if (next.error) setError(next.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Path detect failed');
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const next = await confirmModelInstallApi({
        jobId: job.id,
        type,
        family: needsFamily && family ? family : undefined,
        mode: canLink ? mode : mode === 'link' ? 'copy' : mode,
      });
      setJob(next);
      if (next.status === 'done' && next.filename) {
        onInstalled({ filename: next.filename, type, family: family || undefined });
        const hasDeps =
          Boolean(family) ||
          Boolean(next.companions?.length) ||
          Boolean(job.companions?.length);
        if (hasDeps && (family || job.companions?.length)) {
          setDepPhase(true);
        } else {
          finishAndClose();
        }
      } else if (next.error) {
        setError(next.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setBusy(false);
    }
  };

  const awaitingDownload =
    job &&
    job.status === 'ready' &&
    !job.guessedType &&
    Boolean(job.downloadUrl || job.candidates?.length);

  const readyToInstall = Boolean(job && job.status === 'ready' && job.guessedType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold tracking-tight">Add model</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste a URL, a local path (for Link), or pick a file. Type is detected from the
            safetensors / GGUF header.
          </p>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="model-url">URL</Label>
            <div className="flex gap-2">
              <Input
                id="model-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://huggingface.co/… or civitai.com/…"
                disabled={busy || job?.status === 'downloading'}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !url.trim()}
                onClick={() => void handleResolve()}
              >
                Resolve
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="model-path">Local path</Label>
            <div className="flex gap-2">
              <Input
                id="model-path"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="/path/to/model.safetensors"
                disabled={busy}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !localPath.trim()}
                onClick={() => void handleLocalPath()}
              >
                Detect
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Use a path to Link (symlink) without copying. Defaults to Link when outside ComfyUI.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Or upload a copy</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".safetensors,.ckpt,.pt,.pth,.bin,.gguf"
              className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-[8px] file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
              disabled={busy}
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {job?.candidates && job.candidates.length > 1 ? (
            <div className="space-y-1.5">
              <Label>File in repo</Label>
              <Select value={candidate} onValueChange={setCandidate}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a file" />
                </SelectTrigger>
                <SelectContent>
                  {job.candidates.map((c) => (
                    <SelectItem key={c.path} value={c.path}>
                      {c.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {job && (job.status === 'downloading' || job.status === 'installing') ? (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{job.status === 'downloading' ? 'Downloading…' : 'Installing…'}</span>
                <span className="font-mono tabular-nums">{Math.round(job.progress)}%</span>
              </div>
              <Progress value={job.progress} />
            </div>
          ) : null}

          {job?.filename ? (
            <p className="font-mono text-xs text-foreground">{job.filename}</p>
          ) : null}

          {(readyToInstall || job?.guessedType) && (
            <>
              <div className="space-y-1.5">
                <Label>Type {job?.guessedType ? `(detected: ${job.guessedType})` : ''}</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Install method</Label>
                <Select
                  value={mode}
                  onValueChange={(v) => setMode(v as InstallMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {canLink ? (
                      <SelectItem value="link">Link (keeps file in place)</SelectItem>
                    ) : null}
                    <SelectItem value="copy">Copy into models folder</SelectItem>
                    <SelectItem value="move">Move into models folder</SelectItem>
                  </SelectContent>
                </Select>
                {!canLink ? (
                  <p className="text-[11px] text-muted-foreground">
                    Link needs a local path (uploads and URL downloads use Copy/Move).
                  </p>
                ) : null}
              </div>
            </>
          )}

          {needsFamily && (readyToInstall || job?.guessedType) ? (
            <div className="space-y-1.5">
              <Label>Family</Label>
              <Select
                value={family || '__skip__'}
                onValueChange={(v) => setFamily(v === '__skip__' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select family" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__skip__">Skip for now</SelectItem>
                  {familyOptions.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {keyNeeded ? (
            <div className="space-y-1.5 rounded-md border border-border p-3">
              <Label htmlFor="download-key">{KEY_HELP[keyNeeded].name}</Label>
              <div className="flex gap-2">
                <Input
                  id="download-key"
                  type="password"
                  autoComplete="off"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveKeyAndRetry();
                  }}
                  placeholder={KEY_HELP[keyNeeded].placeholder}
                  disabled={keySaving}
                />
                <Button type="button" disabled={keySaving || !keyDraft.trim() || Boolean(apiKeyProblem(keyDraft))} onClick={() => void saveKeyAndRetry()}>
                  {keySaving ? 'Saving…' : 'Save key and retry'}
                </Button>
              </div>
              {apiKeyProblem(keyDraft) ? <p className="text-xs text-destructive">{apiKeyProblem(keyDraft)}</p> : null}
              <p className="text-xs text-muted-foreground">
                Get one at {KEY_HELP[keyNeeded].where}. It’s saved on the computer running Darkroom and never shown again
                (also in Preferences → Models &amp; folders).
              </p>
            </div>
          ) : null}

          {depPhase ? (
            <DependencyResolver
              familyId={family}
              companions={job?.companions}
              vramTotalBytes={vramTotal}
              onDone={finishAndClose}
              onSkip={finishAndClose}
            />
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          {!depPhase && awaitingDownload ? (
            <Button type="button" disabled={busy} onClick={() => void handleDownload()}>
              Download
            </Button>
          ) : null}
          {!depPhase && readyToInstall ? (
            <Button type="button" disabled={busy} onClick={() => void handleInstall()}>
              {mode === 'link' ? 'Link into models folder' : 'Save to models folder'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
