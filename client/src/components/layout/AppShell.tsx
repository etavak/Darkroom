import type { ReactNode } from 'react';
import { Menu, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Tooltip } from '@/components/ui/tooltip';
import type { HistoryPosition } from '@/lib/uiSettings';
import { cn } from '@/lib/utils';

function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('h-5 w-5 shrink-0', className)}
      aria-hidden
    >
      <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor" className="text-primary" />
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-primary-foreground" />
      <circle cx="12" cy="12" r="2" fill="currentColor" className="text-primary-foreground" />
    </svg>
  );
}

type Props = {
  settings: ReactNode;
  settingsDrawer: ReactNode;
  stage: ReactNode;
  history: ReactNode;
  historyMobile: ReactNode;
  comfyOk: boolean | null;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  uiSettingsOpen: boolean;
  onUiSettingsOpenChange: (open: boolean) => void;
  uiSettings: ReactNode;
  /** Dim left controls when ComfyUI is offline */
  controlsDimmed?: boolean;
  historyPosition?: HistoryPosition;
  resizablePanels?: boolean;
  /** e.g. "Apple M5 · MPS" from /system_stats */
  systemLabel?: string | null;
  vramTooltip?: string | null;
};

export function AppShell({
  settings,
  settingsDrawer,
  stage,
  history,
  historyMobile,
  comfyOk,
  settingsOpen,
  onSettingsOpenChange,
  uiSettingsOpen,
  onUiSettingsOpenChange,
  uiSettings,
  controlsDimmed,
  historyPosition = 'right',
  resizablePanels = false,
  systemLabel,
  vramTooltip,
}: Props) {
  const historyOnRight = historyPosition === 'right';
  const historyOnBottom = historyPosition === 'bottom';
  const historyHidden = historyPosition === 'hidden';
  const subtitle = systemLabel || 'local · ComfyUI';

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-history-position={historyPosition}
      data-resizable-panels={resizablePanels ? 'true' : 'false'}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-3 md:px-4">
        <div className="flex items-center gap-2">
          <Tooltip content="Open controls">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => onSettingsOpenChange(true)}
              aria-label="Open controls"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </Tooltip>
          <div className="flex items-center gap-2">
            <LogoMark />
            <div className="flex items-baseline gap-2.5">
              <h1 className="text-lg font-semibold tracking-tight">Darkroom</h1>
              {vramTooltip ? (
                <Tooltip content={vramTooltip}>
                  <span className="hidden cursor-default text-[11px] text-muted-foreground sm:inline">
                    {subtitle}
                  </span>
                </Tooltip>
              ) : (
                <span className="hidden text-[11px] text-muted-foreground sm:inline">{subtitle}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full transition-colors duration-150',
              comfyOk === null && 'bg-muted-foreground',
              comfyOk === true && 'bg-emerald-500',
              comfyOk === false && 'bg-destructive',
            )}
          />
          <span className="hidden sm:inline">
            {comfyOk === null ? 'Checking…' : comfyOk ? 'ComfyUI connected' : 'ComfyUI offline'}
          </span>
          <Tooltip content="Preferences">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onUiSettingsOpenChange(true)}
              aria-label="Open settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className={cn('flex min-h-0 flex-1', historyOnBottom && 'flex-col')}>
        <div className="flex min-h-0 min-w-0 flex-1">
          <aside
            className={cn(
              'hidden h-full min-h-0 w-[320px] shrink-0 flex-col overflow-hidden border-r bg-card transition-opacity lg:flex xl:w-[360px]',
              resizablePanels && 'min-w-[240px] max-w-[50vw] resize-x',
              controlsDimmed && 'pointer-events-none opacity-40',
            )}
          >
            {settings}
          </aside>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{stage}</main>

          {historyOnRight && !historyHidden && (
            <aside
              className={cn(
                'hidden w-[220px] shrink-0 flex-col border-l bg-card md:flex xl:w-[260px]',
                resizablePanels && 'min-w-[160px] max-w-[40vw] resize-x overflow-auto',
              )}
            >
              {history}
            </aside>
          )}
        </div>

        {historyOnBottom && !historyHidden && (
          <div className="hidden max-h-[40vh] shrink-0 border-t bg-card md:block">{historyMobile}</div>
        )}
      </div>

      {!historyHidden && (
        <div className={cn('shrink-0 border-t bg-card', !historyOnBottom && 'md:hidden')}>
          {historyMobile}
        </div>
      )}

      <Sheet open={settingsOpen} onOpenChange={onSettingsOpenChange}>
        <SheetContent side="left" className="flex w-[min(100%,22rem)] flex-col p-0">
          <SheetHeader className="shrink-0">
            <SheetTitle>Controls</SheetTitle>
          </SheetHeader>
          <Separator />
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col overflow-hidden',
              controlsDimmed && 'pointer-events-none opacity-40',
            )}
          >
            {settingsDrawer}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={uiSettingsOpen} onOpenChange={onUiSettingsOpenChange}>
        <SheetContent side="center" className="gap-0 overflow-hidden p-0">
          <SheetHeader className="shrink-0">
            <SheetTitle>Preferences</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">{uiSettings}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
