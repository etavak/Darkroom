import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AUTH_REQUIRED_EVENT, fetchAuthStatus, submitLanPin } from '@/lib/api';

type GateState = 'checking' | 'open' | 'locked';

/**
 * Shows the PIN screen on other devices until they sign in. The computer running
 * Darkroom never sees it. Re-locks if the server later answers auth_required
 * (e.g. the PIN was regenerated).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('checking');

  const check = useCallback(() => {
    fetchAuthStatus()
      .then((s) => setState(s.authorized ? 'open' : 'locked'))
      // Server unreachable: let the app render its own offline state
      .catch(() => setState('open'));
  }, []);

  useEffect(() => {
    check();
    const relock = () => setState('locked');
    window.addEventListener(AUTH_REQUIRED_EVENT, relock);
    // Notice a regenerated PIN even when the page is idle (only re-locks, never unlocks)
    const recheck = () => {
      if (document.visibilityState !== 'visible') return;
      fetchAuthStatus()
        .then((s) => {
          if (!s.authorized) relock();
        })
        .catch(() => {});
    };
    const id = window.setInterval(recheck, 30_000);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, relock);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [check]);

  if (state === 'checking') return null;
  if (state === 'locked') return <PinScreen onUnlocked={() => window.location.reload()} />;
  return <>{children}</>;
}

function PinScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const submit = async (value: string) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitLanPin(value);
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
      setPin('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <form
        className="w-full max-w-xs space-y-5 rounded-[16px] border border-border bg-card p-6 text-center shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(pin);
        }}
      >
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Lock className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <h1 className="text-base font-semibold tracking-tight">Enter Darkroom PIN</h1>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Find it on the computer running Darkroom — in the launcher next to the network
            address, or in Preferences → Network.
          </p>
        </div>
        <input
          ref={inputRef}
          value={pin}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, '').slice(0, 6);
            setPin(next);
            if (next.length === 6) void submit(next);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="PIN"
          placeholder="••••••"
          disabled={busy}
          className="h-12 w-full rounded-[10px] border border-input bg-background text-center font-mono text-2xl tracking-[0.5em] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy || pin.length !== 6}>
          {busy ? 'Checking…' : 'Unlock'}
        </Button>
      </form>
    </div>
  );
}
