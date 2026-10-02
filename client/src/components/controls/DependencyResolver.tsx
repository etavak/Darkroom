import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  analyzeDependenciesApi,
  createDependencyPlanApi,
  executeDependencyPlanApi,
  fetchDependencyPlan,
  saveHfTokenApi,
} from '@/lib/api';
import type { DependencyAnalysis, DependencyPlan, ModelInstallJob } from '@/types/generation';

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '?';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

type RoleChoiceState = {
  action: 'download' | 'skip' | 'local';
  componentId?: string;
  localPath?: string;
  mode?: 'copy' | 'move' | 'link';
};

type Props = {
  familyId: string;
  companions?: ModelInstallJob['companions'];
  vramTotalBytes?: number | null;
  onDone: () => void;
  onSkip: () => void;
};

function companionsToExtras(companions?: ModelInstallJob['companions']) {
  return (companions || [])
    .filter((c) => c.fileType === 'VAE' || /vae/i.test(c.filename))
    .map((c) => ({
      id: `civitai-vae-${c.filename}`,
      type: 'vae',
      filename: c.filename,
      url: c.downloadUrl,
      sizeBytes: c.size,
      sha256: c.sha256 || '',
      gated: false,
      notes: 'VAE listed on the Civitai model version',
    }));
}

export function DependencyResolver({
  familyId,
  companions,
  vramTotalBytes,
  onDone,
  onSkip,
}: Props) {
  const [analysis, setAnalysis] = useState<DependencyAnalysis | null>(null);
  const [choices, setChoices] = useState<Record<string, RoleChoiceState>>({});
  const [plan, setPlan] = useState<DependencyPlan | null>(null);
  const [phase, setPhase] = useState<'loading' | 'choose' | 'summary' | 'running' | 'done'>('loading');
  const [hfToken, setHfToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const extras = useMemo(() => companionsToExtras(companions), [companions]);
  const extrasKey = useMemo(() => extras.map((e) => e.id).join('|'), [extras]);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);
    void analyzeDependenciesApi({
      familyId: familyId || '_companions',
      vramGB: vramTotalBytes != null ? vramTotalBytes / 1e9 : null,
      extras,
    })
      .then((a) => {
        if (cancelled) return;
        setAnalysis(a);
        const initial: Record<string, RoleChoiceState> = {};
        for (const role of a.roles) {
          if (role.status === 'satisfied') continue;
          if (role.options.length === 1) {
            initial[role.role] = {
              action: 'download',
              componentId: role.options[0].id,
            };
          } else {
            initial[role.role] = {
              action: 'download',
              componentId: role.preselected || role.options[0]?.id,
            };
          }
        }
        setChoices(initial);
        const pending = a.roles.filter((r) => r.status !== 'satisfied');
        if (pending.length === 0) {
          setPhase('done');
          onDoneRef.current();
          return;
        }
        setPhase('choose');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Analyze failed');
        setPhase('choose');
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, vramTotalBytes, extrasKey, extras]);

  useEffect(() => {
    if (!plan || plan.status !== 'running') return;
    const id = window.setInterval(() => {
      void fetchDependencyPlan(plan.id).then((next) => {
        setPlan(next);
        if (next.status === 'done') {
          setPhase('done');
          onDoneRef.current();
        } else if (next.status === 'error') {
          setError(next.error || 'Download failed');
          setPhase('summary');
        }
      });
    }, 400);
    return () => window.clearInterval(id);
  }, [plan?.id, plan?.status]);

  const pendingRoles =
    analysis?.roles.filter((r) => r.status !== 'satisfied') ?? [];

  const buildSummary = async () => {
    setBusy(true);
    setError(null);
    try {
      const choiceList = pendingRoles.map((role) => {
        const c = choices[role.role] || { action: 'skip' as const };
        return {
          role: role.role,
          action: c.action,
          componentId: c.componentId,
          localPath: c.localPath,
          mode: c.mode,
        };
      });
      const next = await createDependencyPlanApi({
        familyId: familyId || '_companions',
        choices: choiceList,
        extras,
        hfToken: hfToken.trim() || undefined,
      });
      setPlan(next);
      if (next.items.length === 0) {
        onDone();
        return;
      }
      setPhase('summary');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Plan failed');
    } finally {
      setBusy(false);
    }
  };

  const runPlan = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      if (plan.needsHfToken && hfToken.trim()) {
        await saveHfTokenApi(hfToken.trim());
      }
      const next = await executeDependencyPlanApi({
        planId: plan.id,
        hfToken: hfToken.trim() || undefined,
      });
      setPlan(next);
      setPhase('running');
      if (next.status === 'done') {
        setPhase('done');
        onDone();
      } else if (next.status === 'error') {
        setError(next.error || 'Download failed');
        setPhase('summary');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execute failed');
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'loading') {
    return (
      <div className="space-y-2 py-2">
        <p className="text-sm text-muted-foreground">Checking companion models…</p>
      </div>
    );
  }

  if (phase === 'done') return null;

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div>
        <h3 className="text-sm font-semibold">Companion models</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Install text encoders / VAE required by this family.
          {analysis?.vramGB != null
            ? ` Detected ~${analysis.vramGB.toFixed(1)} GB VRAM.`
            : ''}
        </p>
      </div>

      {phase === 'choose' &&
        pendingRoles.map((role) => {
          const choice = choices[role.role] || { action: 'download' as const };
          return (
            <div key={role.role} className="space-y-2 rounded-md border border-border/60 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <Label className="text-sm">
                  {role.role}
                  {!role.required && (
                    <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
                  )}
                </Label>
              </div>
              <Select
                value={
                  choice.action === 'skip'
                    ? '__skip__'
                    : choice.action === 'local'
                      ? '__local__'
                      : choice.componentId || role.preselected || ''
                }
                onValueChange={(v) => {
                  if (v === '__skip__') {
                    setChoices((prev) => ({ ...prev, [role.role]: { action: 'skip' } }));
                  } else if (v === '__local__') {
                    setChoices((prev) => ({
                      ...prev,
                      [role.role]: {
                        action: 'local',
                        componentId: role.preselected || role.options[0]?.id,
                        mode: 'link',
                        localPath: choice.localPath || '',
                      },
                    }));
                  } else {
                    setChoices((prev) => ({
                      ...prev,
                      [role.role]: { action: 'download', componentId: v },
                    }));
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {role.options.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.filename} · {formatBytes(o.sizeBytes)}
                      {o.recommended ? ' · recommended' : ''}
                      {o.notes ? ` — ${o.notes}` : ''}
                    </SelectItem>
                  ))}
                  <SelectItem value="__skip__">Skip</SelectItem>
                  <SelectItem value="__local__">I already have it</SelectItem>
                </SelectContent>
              </Select>
              {choice.action === 'local' && (
                <div className="space-y-2">
                  <Input
                    placeholder="/path/to/file.safetensors"
                    value={choice.localPath || ''}
                    onChange={(e) =>
                      setChoices((prev) => ({
                        ...prev,
                        [role.role]: { ...choice, localPath: e.target.value },
                      }))
                    }
                  />
                  <Select
                    value={choice.mode || 'link'}
                    onValueChange={(v) =>
                      setChoices((prev) => ({
                        ...prev,
                        [role.role]: {
                          ...choice,
                          mode: v as 'copy' | 'move' | 'link',
                        },
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="link">Link</SelectItem>
                      <SelectItem value="copy">Copy</SelectItem>
                      <SelectItem value="move">Move</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          );
        })}

      {phase === 'summary' && plan && (
        <div className="space-y-2 text-sm">
          <ul className="space-y-1">
            {plan.items.map((item) => (
              <li key={`${item.role}-${item.filename}`}>
                {item.filename} · {formatBytes(item.sizeBytes)}
                {item.gated ? ' · gated' : ''}
                {item.notes ? ` — ${item.notes}` : ''}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Total {plan.totalLabel} · Free disk {plan.freeDiskLabel}
          </p>
          {plan.needsHfToken && (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="text-xs">
                Gated Hugging Face file(s). Accept the license on the page below, then paste an HF
                token if not already in .env (saved when provided):
              </p>
              {plan.gatedLicenseUrls.map((u) => (
                <a
                  key={u}
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-xs text-primary underline"
                >
                  {u}
                </a>
              ))}
              <Input
                type="password"
                placeholder="hf_… (optional if already set)"
                value={hfToken}
                onChange={(e) => setHfToken(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {(phase === 'running' || plan?.status === 'running') && plan && (
        <div className="space-y-2">
          <Progress value={plan.progress} />
          <p className="text-xs text-muted-foreground">
            {plan.currentFile
              ? `Downloading ${plan.currentFile}…`
              : `Downloading… ${plan.progress.toFixed(0)}%`}
          </p>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={onSkip}>
          Skip companions
        </Button>
        {phase === 'choose' && (
          <Button type="button" disabled={busy} onClick={() => void buildSummary()}>
            Continue
          </Button>
        )}
        {phase === 'summary' && (
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setPhase('choose')}>
              Back
            </Button>
            <Button type="button" disabled={busy} onClick={() => void runPlan()}>
              Download {plan?.totalLabel}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
