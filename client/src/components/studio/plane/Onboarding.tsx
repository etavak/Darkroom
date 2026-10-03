import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { LogoMark } from '../LogoMark';

type Props = {
  /** ComfyUI reachable (null while checking) */
  comfyOk: boolean | null;
  systemLabel?: string | null;
  remote: boolean;
  starting: boolean;
  onStartComfy: () => void;
  /** Name of the model ready to use (null when nothing is installed) */
  modelName: string | null;
  onAddModel: () => void;
  onExample: () => void;
};

function Step({ n, done, active, title, body, children }: { n: number; done: boolean; active: boolean; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex gap-3" style={{ opacity: done || active ? 1 : 0.55 }}>
      <span
        className="st-mono inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
        style={
          done
            ? { background: 'rgba(91,209,139,.18)', color: '#5bd18b' }
            : active
              ? { background: 'var(--s-accent)', color: 'var(--s-accent-ink)' }
              : { background: 'var(--s-raised2)', color: 'var(--s-muted)' }
        }
      >
        {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[14.5px] font-semibold">{title}</span>
          <span className="text-[12.5px] leading-snug" style={{ color: 'var(--s-muted)' }}>{body}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** First run (no images yet): ComfyUI → a model → the first prompt. */
export function Onboarding(p: Props) {
  const comfyDone = p.comfyOk === true;
  const modelDone = Boolean(p.modelName);
  return (
    <div className="st-onboard" data-tip-zone="right" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-3">
        <LogoMark size={30} />
        <div>
          <div className="text-[19px] font-semibold">Welcome to Darkroom</div>
          <div className="text-[13.5px]" style={{ color: 'var(--s-muted)' }}>Three steps to your first image.</div>
        </div>
      </div>

      <Step
        n={1}
        done={comfyDone}
        active={!comfyDone}
        title={comfyDone ? 'ComfyUI is running' : p.comfyOk === null ? 'Checking ComfyUI…' : 'Start ComfyUI'}
        body={
          comfyDone
            ? p.systemLabel
              ? `Connected · ${p.systemLabel}`
              : 'Connected'
            : p.remote
              ? 'Start ComfyUI on the remote computer — Darkroom connects on its own.'
              : 'Darkroom draws with ComfyUI. The launcher installed it; start it here or from the launcher.'
        }
      >
        {!comfyDone && !p.remote && p.comfyOk === false ? (
          <div>
            <button type="button" className="st-pill st-pill-accent" disabled={p.starting} onClick={p.onStartComfy} data-tip="Start the local ComfyUI">
              {p.starting ? 'Starting…' : 'Start ComfyUI'}
            </button>
          </div>
        ) : null}
      </Step>

      <Step
        n={2}
        done={modelDone}
        active={comfyDone && !modelDone}
        title={modelDone ? `${p.modelName} is ready` : 'Add a model'}
        body={
          modelDone
            ? 'You can add more later from the Model menu or the launcher.'
            : 'Paste a Hugging Face or Civitai link, or pick a file you already have. Illustrious or Pony for anime, an SDXL photo model for realism, Flux for long descriptions.'
        }
      >
        {!modelDone ? (
          <div>
            <button type="button" className="st-pill st-pill-accent" disabled={!comfyDone} onClick={p.onAddModel} data-tip={comfyDone ? 'Download or import a model' : 'Start ComfyUI first'}>
              Add a model
            </button>
          </div>
        ) : null}
      </Step>

      <Step
        n={3}
        done={false}
        active={comfyDone && modelDone}
        title="Describe your image and press Generate"
        body="Write in the Prompt box on the left, or start from an example."
      >
        {comfyDone && modelDone ? (
          <div>
            <button type="button" className="st-pill" onClick={p.onExample} data-tip="Fill the prompt with an example for this model">
              Use an example prompt
            </button>
          </div>
        ) : null}
      </Step>
    </div>
  );
}
