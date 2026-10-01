import type { ReactNode } from 'react';
import { Menu, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

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
}: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-3 md:px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => onSettingsOpenChange(true)}
            aria-label="Open controls"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-lg font-semibold tracking-tight">Darkroom</h1>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              local · ComfyUI
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              comfyOk === null && 'bg-muted-foreground',
              comfyOk === true && 'bg-emerald-500',
              comfyOk === false && 'bg-destructive',
            )}
          />
          <span className="hidden sm:inline">
            {comfyOk === null ? 'Checking…' : comfyOk ? 'ComfyUI connected' : 'ComfyUI offline'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onUiSettingsOpenChange(true)}
            aria-label="Open settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[320px] shrink-0 flex-col border-r bg-card lg:flex xl:w-[360px]">
          {settings}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">{stage}</main>

        <aside className="hidden w-[220px] shrink-0 flex-col border-l bg-card md:flex xl:w-[260px]">
          {history}
        </aside>
      </div>

      <div className="shrink-0 border-t bg-card md:hidden">{historyMobile}</div>

      <Sheet open={settingsOpen} onOpenChange={onSettingsOpenChange}>
        <SheetContent side="left" className="w-[min(100%,22rem)] p-0">
          <SheetHeader>
            <SheetTitle>Controls</SheetTitle>
          </SheetHeader>
          <Separator />
          <div className="min-h-0 flex-1 overflow-hidden">{settingsDrawer}</div>
        </SheetContent>
      </Sheet>

      <Sheet open={uiSettingsOpen} onOpenChange={onUiSettingsOpenChange}>
        <SheetContent side="right" className="w-[min(100%,22rem)] p-0">
          <SheetHeader>
            <SheetTitle>Settings</SheetTitle>
          </SheetHeader>
          <Separator />
          <div className="min-h-0 flex-1 overflow-y-auto">{uiSettings}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
