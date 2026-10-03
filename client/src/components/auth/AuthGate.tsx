import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LogoMark } from '@/components/studio/PreferencesScreen';
import '@/components/studio/studio.css';
import { applyUiAppearance, loadUiSettings } from '@/lib/uiSettings';
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

  // The app hasn't loaded yet: take on the studio palette here
  useEffect(() => {
    const root = document.documentElement;
    applyUiAppearance(loadUiSettings());
    root.dataset.ui = 'studio';
    inputRef.current?.focus();
    return () => {
      delete root.dataset.ui;
    };
  }, []);

  const submit = async (value: string) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitLanPin(value);
      onUnlocked();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not sign in';
      setError(msg === 'Wrong PIN' ? 'That PIN didn’t match. Check the computer and try again.' : msg);
      setPin('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="st-pin"
      role="dialog"
      aria-label="Enter Darkroom PIN"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(pin);
      }}
    >
      <LogoMark size={40} />
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[21px] font-semibold">Enter the Darkroom PIN</h1>
        <p className="m-0 max-w-[300px] text-sm leading-normal" style={{ color: 'var(--s-muted)' }}>
          Find the code on the computer running Darkroom — in the launcher’s Phones &amp; tablets, or Preferences → Network. It changes every 30 seconds.
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
        className="st-pin-input st-mono"
      />
      {error ? <span className="text-[13px]" style={{ color: '#f0857f' }}>{error}</span> : null}
      <button type="submit" className="st-gen h-12 w-[230px] justify-center" disabled={busy || pin.length !== 6}>
        {busy ? 'Checking…' : 'Unlock'}
      </button>
    </form>
  );
}
