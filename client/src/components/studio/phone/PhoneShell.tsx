import { useEffect, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import type { PreferenceProps } from '@/components/settings/AppSettingsPanel';
import { LogoMark, PreferencesScreen } from '../PreferencesScreen';
import { TooltipRoot } from '../TooltipLayer';
import { EnhanceIcon } from '../plane/icons';
import '../studio.css';

type Props = {
  modelName: string;
  status: { dot: string; tip: string };
  toolsOpen: boolean;
  onTools: () => void;
  prefsOpen: boolean;
  onPrefsOpenChange: (open: boolean) => void;
  preferences: PreferenceProps;
  /** The selected image (with progress, compare, long-press) */
  viewer: ReactNode;
  /** Thumbnail strip along the bottom of the viewer */
  thumbs: ReactNode;
  /** Prompt + settings section with Generate pinned at the bottom */
  controls: ReactNode;
  /** The open bottom sheet (Tools, LoRAs, chunks, image actions…) */
  sheet: ReactNode | null;
  /** Full-screen layers (mask editor, drop chooser) */
  overlay?: ReactNode;
};

/**
 * The phone layout: header · the selected image with a thumbnail strip · the prompt and
 * Generate. Model, style and image actions live in the Tools sheet; press and hold an image
 * for its actions, or any button for its tooltip.
 */
export function PhoneShell(p: Props) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.ui = 'studio';
    return () => {
      delete root.dataset.ui;
    };
  }, []);

  return (
    <TooltipRoot className="st-phone">
      <header className="st-ph-header" data-tip-zone="below">
        <LogoMark />
        <span className="ml-1.5 flex min-w-0 flex-col leading-tight">
          <span className="text-base font-semibold">Darkroom</span>
          <span className="truncate text-[11.5px]" style={{ color: 'var(--s-muted)' }}>{p.modelName}</span>
        </span>
        <span className="flex-1" />
        <span className="st-ph-statusdot" role="status" tabIndex={0} data-tip={p.status.tip}>
          <span className="st-dot" style={{ background: p.status.dot }} />
        </span>
        <button type="button" className={`st-ibtn ${p.toolsOpen ? 'on' : ''}`} onClick={p.onTools} aria-haspopup="dialog" aria-label="Tools" data-tip="Tools — model, style and image actions">
          <EnhanceIcon />
        </button>
        <button type="button" className="st-ibtn" onClick={() => p.onPrefsOpenChange(true)} aria-label="Preferences" data-tip="Preferences">
          <Menu />
        </button>
      </header>
      <main className="st-ph-main">
        {p.viewer}
        {p.thumbs}
      </main>
      {p.controls}
      {p.sheet}
      {p.overlay}
      {p.prefsOpen ? <PreferencesScreen {...p.preferences} onClose={() => p.onPrefsOpenChange(false)} /> : null}
    </TooltipRoot>
  );
}

/** Bottom sheet: dims the page, slides up from the bottom, closes on the backdrop or ✕. */
export function PhoneSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="st-sheetwrap" onClick={onClose}>
      <div className="st-sheet" role="dialog" aria-label={title} data-tip-zone="above" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between pl-1.5 pr-1">
          <span className="text-[17px] font-semibold">{title}</span>
          <button type="button" className="st-ibtn" onClick={onClose} aria-label="Close" data-tip="Close">
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
