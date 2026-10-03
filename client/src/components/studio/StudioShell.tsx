import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import type { PreferenceProps } from '@/components/settings/AppSettingsPanel';
import type { UiSettings } from '@/lib/uiSettings';
import { LogoMark, PreferencesScreen } from './PreferencesScreen';
import { TooltipRoot } from './TooltipLayer';
import './studio.css';

const LEFT = { min: 320, max: 480, initial: 360 };
const HISTORY = { min: 120, max: 440, initial: 176 };

type Props = {
  /** Left column body (controls + pinned Generate footer) */
  controls: ReactNode;
  /** The image plane (renders its own <main>) */
  stage: ReactNode;
  history: ReactNode;
  /** Details panel between the plane and History (null when closed) */
  details?: ReactNode;
  /** Full-window layer above everything (the inpaint & extend editor) */
  overlay?: ReactNode;
  historyCount: number;
  comfyOk: boolean | null;
  systemLabel?: string | null;
  vramTooltip?: string | null;
  running: boolean;
  progressLabel?: string | null;
  onGenerate: () => void;
  ui: UiSettings;
  onUiPatch: (partial: Partial<UiSettings>) => void;
  prefsOpen: boolean;
  onPrefsOpenChange: (open: boolean) => void;
  preferences: PreferenceProps;
};

/**
 * The studio layout: controls column · image plane · History rail. Both side columns
 * collapse to slim rails and resize by dragging their inner edge (double-click resets).
 */
export function StudioShell({
  controls,
  stage,
  history,
  details,
  overlay,
  historyCount,
  comfyOk,
  systemLabel,
  vramTooltip,
  running,
  progressLabel,
  onGenerate,
  ui,
  onUiPatch,
  prefsOpen,
  onPrefsOpenChange,
  preferences,
}: Props) {
  // Widths follow the pointer locally while dragging and are saved once on release
  const [drag, setDrag] = useState<{ which: 'left' | 'history'; width: number } | null>(null);
  const edge = useRef<{ which: 'left' | 'history'; sx: number; w0: number; f: number } | null>(null);
  const raf = useRef(0);
  const historyLeft = ui.historyPosition === 'left';
  const historyHidden = ui.historyPosition === 'hidden';
  const leftW = drag?.which === 'left' ? drag.width : ui.studioLeftWidth;
  const histW = drag?.which === 'history' ? drag.width : ui.studioHistoryWidth;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.ui = 'studio';
    return () => {
      delete root.dataset.ui;
    };
  }, []);

  // Pop-outs (prompt panel, model menu) size and place themselves from the column width
  useEffect(() => {
    const root = document.documentElement;
    const w = ui.studioLeftCollapsed ? 60 : leftW;
    root.style.setProperty('--st-left-w', `${w}px`);
    root.style.setProperty('--st-pop-left', `${w + 12}px`);
  }, [leftW, ui.studioLeftCollapsed]);

  // Ctrl/⌘ + \ shows or hides the controls column
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        onUiPatch({ studioLeftCollapsed: !ui.studioLeftCollapsed });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onUiPatch, ui.studioLeftCollapsed]);

  const startEdge = (which: 'left' | 'history') => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    edge.current = {
      which,
      sx: e.clientX,
      w0: which === 'left' ? ui.studioLeftWidth : ui.studioHistoryWidth,
      f: r.width / e.currentTarget.offsetWidth || 1,
    };
    document.body.dataset.stDragging = '1';
    setDrag({ which, width: edge.current.w0 });
  };
  const moveEdge = (e: PointerEvent<HTMLDivElement>) => {
    const d = edge.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.f;
    const lim = d.which === 'left' ? LEFT : HISTORY;
    const signed = d.which === 'left' ? dx : historyLeft ? dx : -dx;
    const width = Math.round(Math.min(lim.max, Math.max(lim.min, d.w0 + signed)));
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setDrag({ which: d.which, width }));
  };
  const endEdge = () => {
    const d = edge.current;
    if (!d) return;
    edge.current = null;
    delete document.body.dataset.stDragging;
    cancelAnimationFrame(raf.current);
    setDrag((cur) => {
      if (cur) onUiPatch(cur.which === 'left' ? { studioLeftWidth: cur.width } : { studioHistoryWidth: cur.width });
      return null;
    });
    // Let the stage re-measure for the new width
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  };
  const resetEdge = (which: 'left' | 'history') => () =>
    onUiPatch(which === 'left' ? { studioLeftWidth: LEFT.initial } : { studioHistoryWidth: HISTORY.initial });

  const setCollapsed = useCallback(
    (patch: Partial<UiSettings>) => {
      onUiPatch(patch);
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    },
    [onUiPatch],
  );

  const status =
    comfyOk === null
      ? { dot: 'var(--s-faint)', label: 'Checking…', tip: 'Checking the ComfyUI connection' }
      : comfyOk
        ? { dot: '#5bd18b', label: systemLabel || 'Connected', tip: vramTooltip || 'ComfyUI is connected' }
        : { dot: '#e5534b', label: 'ComfyUI offline', tip: 'Can’t reach ComfyUI — start it from the launcher' };
  const narrowChip = leftW < 360;

  const edgeEl = (which: 'left' | 'history', style: React.CSSProperties) =>
    ui.resizablePanels ? (
      <div
        className={`st-edge ${drag?.which === which ? 'on' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={which === 'left' ? 'Resize controls' : 'Resize history'}
        data-tip="Drag to resize · double-click to reset"
        onPointerDown={startEdge(which)}
        onPointerMove={moveEdge}
        onPointerUp={endEdge}
        onPointerCancel={endEdge}
        onDoubleClick={resetEdge(which)}
        style={style}
      >
        <span />
      </div>
    ) : null;

  return (
    <TooltipRoot className="st-root">
      {ui.studioLeftCollapsed ? (
        <aside className="st-col st-col-left st-rail" data-tip-zone="right" aria-label="Controls (collapsed)">
          <span className="mb-2">
            <LogoMark />
          </span>
          <button type="button" className="st-ibtn" onClick={() => setCollapsed({ studioLeftCollapsed: false })} aria-label="Show controls" data-tip="Show controls  ·  Ctrl \">
            <PanelLeftOpen />
          </button>
          <button type="button" className="st-ibtn" onClick={() => onPrefsOpenChange(true)} aria-label="Preferences" data-tip="Preferences">
            <Menu />
          </button>
          <span className="flex-1" />
          {running && progressLabel ? (
            <span className="st-mono text-[11px]" style={{ color: 'var(--s-accent)' }} data-tip={progressLabel} tabIndex={0}>
              {progressLabel.match(/\d+%/)?.[0] ?? '…'}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onGenerate}
            aria-label="Generate"
            data-tip="Generate  ·  Ctrl ↵"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border-0"
            style={{ background: 'var(--s-accent)', color: 'var(--s-accent-ink)' }}
          >
            <Sparkles className="h-5 w-5" />
          </button>
        </aside>
      ) : (
        <aside className="st-col st-col-left" data-tip-zone="right" style={{ width: leftW }} aria-label="Controls">
          <div className="flex min-w-0 items-center justify-between gap-2 py-3 pl-[18px] pr-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <LogoMark />
              <span className="text-[17px] font-semibold tracking-tight">Darkroom</span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <span className="st-status" role="status" tabIndex={0} data-tip={status.tip} style={{ padding: narrowChip ? '0 9px' : '0 10px' }}>
                <span className="st-dot" style={{ background: status.dot }} />
                {narrowChip ? null : status.label}
              </span>
              <button type="button" className="st-ibtn" onClick={() => setCollapsed({ studioLeftCollapsed: true })} aria-label="Hide controls" data-tip="Hide controls  ·  Ctrl \">
                <PanelLeftClose />
              </button>
              <button type="button" className="st-ibtn" onClick={() => onPrefsOpenChange(true)} aria-label="Preferences" aria-expanded={prefsOpen} data-tip="Preferences">
                <Menu />
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{controls}</div>
          {edgeEl('left', { right: -5 })}
        </aside>
      )}

      {stage}
      {details}

      {historyHidden ? null : ui.studioHistoryCollapsed ? (
        <aside
          className="st-col st-col-history st-rail"
          style={{ order: historyLeft ? 1 : 4, width: 52 }}
          data-tip-zone={historyLeft ? 'right' : 'left'}
          aria-label="History (collapsed)"
        >
          <button type="button" className="st-ibtn" onClick={() => setCollapsed({ studioHistoryCollapsed: false })} aria-label="Show history" data-tip="Show history">
            {historyLeft ? <PanelLeftOpen /> : <PanelRightOpen />}
          </button>
          <span className="st-mono text-xs" style={{ color: 'var(--s-muted)' }} data-tip="Images in history" tabIndex={0}>
            {historyCount}
          </span>
        </aside>
      ) : (
        <aside
          className="st-col st-col-history"
          style={{ order: historyLeft ? 1 : 4, width: histW }}
          data-tip-zone={historyLeft ? 'right' : 'left'}
          aria-label="History"
        >
          <div className="flex h-[62px] min-w-0 shrink-0 items-center justify-between gap-1.5 pl-3.5 pr-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="text-[15px] font-semibold">History</span>
              <span className="st-badge st-mono" data-tip="Images in history" tabIndex={0}>
                {historyCount}
              </span>
            </span>
            <button type="button" className="st-ibtn h-[34px] w-[34px]" onClick={() => setCollapsed({ studioHistoryCollapsed: true })} aria-label="Hide history" data-tip="Hide history">
              {historyLeft ? <PanelLeftClose /> : <PanelRightClose />}
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{history}</div>
          {edgeEl('history', historyLeft ? { right: -5 } : { left: -5 })}
        </aside>
      )}

      {overlay}
      {prefsOpen ? <PreferencesScreen {...preferences} onClose={() => onPrefsOpenChange(false)} /> : null}
    </TooltipRoot>
  );
}
