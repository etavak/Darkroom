import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageIcon, Loader2, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { imageUrl } from '@/lib/api';
import type { CanvasBackground } from '@/lib/uiSettings';
import { cn } from '@/lib/utils';

type Props = {
  previewUrl: string | null;
  resultImages: string[];
  running: boolean;
  width: number;
  height: number;
  progressStep: number;
  progressMax: number;
  offline?: boolean;
  remoteMode?: boolean;
  onStartComfy?: () => void;
  startingComfy?: boolean;
  onDropSettingsFile?: (file: File) => void;
  canvasBackground?: CanvasBackground;
};

const CANVAS_BG: Record<CanvasBackground, string> = {
  theme: 'bg-card',
  neutral: 'bg-[#535353]',
  black: 'bg-black',
};

/** Fit (contain) a size into a box while preserving aspect ratio. */
function containSize(
  boxW: number,
  boxH: number,
  aspectW: number,
  aspectH: number,
): { w: number; h: number } {
  if (boxW <= 0 || boxH <= 0 || aspectW <= 0 || aspectH <= 0) {
    return { w: 0, h: 0 };
  }
  const ar = aspectW / aspectH;
  let w = boxW;
  let h = w / ar;
  if (h > boxH) {
    h = boxH;
    w = h * ar;
  }
  return { w: Math.floor(w), h: Math.floor(h) };
}

export function PreviewCanvas({
  previewUrl,
  resultImages,
  running,
  width,
  height,
  progressStep,
  progressMax,
  offline = false,
  remoteMode = false,
  onStartComfy,
  startingComfy = false,
  onDropSettingsFile,
  canvasBackground = 'theme',
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });

  const src = previewUrl ?? (resultImages[0] ? imageUrl(resultImages[0]) : null);
  const pct =
    progressMax > 0 ? Math.min(100, Math.round((progressStep / progressMax) * 100)) : 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setFrame(containSize(rect.width, rect.height, width, height));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [width, height]);

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!onDropSettingsFile) return;
      e.preventDefault();
      setDragOver(true);
    },
    [onDropSettingsFile],
  );

  const onDragLeave = useCallback(() => setDragOver(false), []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!onDropSettingsFile) return;
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onDropSettingsFile(file);
    },
    [onDropSettingsFile],
  );

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 w-full items-center justify-center"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={cn(
        'relative flex flex-col items-center justify-center overflow-hidden rounded-[16px] border border-border',
          CANVAS_BG[canvasBackground],
          dragOver && 'ring-2 ring-primary/50',
        )}
        data-canvas-background={canvasBackground}
        style={
          frame.w > 0 && frame.h > 0
            ? { width: frame.w, height: frame.h }
            : { width: '100%', height: '100%', maxHeight: '100%' }
        }
      >
        {src ? (
          <img src={src} alt="Preview" className="h-full w-full object-contain" />
        ) : offline ? (
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <Power className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <p className="text-sm font-medium text-foreground">ComfyUI is offline</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                {remoteMode
                  ? 'Start ComfyUI on the remote host, then wait for reconnect.'
                  : 'Start the local ComfyUI process to begin generating.'}
              </p>
            </div>
            {!remoteMode && onStartComfy && (
              <Button onClick={onStartComfy} disabled={startingComfy} size="sm" variant="default">
                {startingComfy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  'Start ComfyUI'
                )}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ImageIcon className="h-12 w-12 opacity-40" />
            <p className="text-sm">No preview yet</p>
            <p className="text-xs opacity-70">
              {width} × {height}
            </p>
          </div>
        )}

        {running && (
          <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10">
            <div className="flex items-center justify-between text-xs text-white/90">
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Generating…
              </span>
              <span>
                {progressMax > 0 ? `STEP ${progressStep}/${progressMax}` : `${pct}%`}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/80 text-sm font-medium">
            Drop image to load settings
          </div>
        )}
      </div>
    </div>
  );
}
