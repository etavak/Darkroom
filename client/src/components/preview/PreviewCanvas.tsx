import { useCallback, useEffect, useRef, useState } from 'react';
import { Columns2, ImageIcon, Loader2, Maximize2, Power, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { imageUrl } from '@/lib/api';
import type { CanvasBackground } from '@/lib/uiSettings';
import { cn } from '@/lib/utils';

type Props = {
  previewUrl: string | null;
  resultImages: string[];
  /** Previous completed image for A/B compare */
  compareImage?: string | null;
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
  emptyModelState?: boolean;
  onAddModel?: () => void;
};

const CANVAS_BG: Record<CanvasBackground, string> = {
  theme: 'bg-card',
  neutral: 'bg-[#535353]',
  black: 'bg-black',
};

type ViewMode = 'fit' | '100%';

export function PreviewCanvas({
  previewUrl,
  resultImages,
  compareImage = null,
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
  emptyModelState = false,
  onAddModel,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('fit');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [compare, setCompare] = useState(false);
  const [comparePct, setComparePct] = useState(50);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const src = previewUrl ?? (resultImages[0] ? imageUrl(resultImages[0]) : null);
  const compareSrc = compareImage ? imageUrl(compareImage) : null;
  const pct =
    progressMax > 0 ? Math.min(100, Math.round((progressStep / progressMax) * 100)) : 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setBox({ w: rect.width, h: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (viewMode === 'fit') {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [viewMode, src]);

  const fitScale =
    box.w > 0 && box.h > 0 && width > 0 && height > 0
      ? Math.min(box.w / width, box.h / height)
      : 1;
  const displayScale = viewMode === 'fit' ? fitScale * zoom : zoom;
  const imgW = Math.max(1, Math.round(width * displayScale));
  const imgH = Math.max(1, Math.round(height * displayScale));

  const onWheel = (e: React.WheelEvent) => {
    if (!src) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setViewMode('100%');
    setZoom((z) => Math.min(8, Math.max(0.1, z * delta)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!spaceDown && e.button !== 1) return;
    e.preventDefault();
    setPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!panning) return;
    setPan({
      x: panStart.current.panX + (e.clientX - panStart.current.x),
      y: panStart.current.panY + (e.clientY - panStart.current.y),
    });
  };

  const onPointerUp = () => setPanning(false);

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

  const showCompare = Boolean(compare && src && compareSrc && !running);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-[8px] border border-border/80 bg-card/90 p-0.5 shadow-sm backdrop-blur">
        <Button
          type="button"
          size="sm"
          variant={viewMode === 'fit' && zoom === 1 ? 'secondary' : 'ghost'}
          className="h-7 px-2 text-[11px]"
          onClick={() => {
            setViewMode('fit');
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          title="Fit"
        >
          <Maximize2 className="mr-1 h-3 w-3" />
          Fit
        </Button>
        <Button
          type="button"
          size="sm"
          variant={viewMode === '100%' && Math.abs(zoom - 1) < 0.01 ? 'secondary' : 'ghost'}
          className="h-7 px-2 text-[11px]"
          onClick={() => {
            setViewMode('100%');
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          title="100%"
        >
          <ZoomIn className="mr-1 h-3 w-3" />
          100%
        </Button>
        <Button
          type="button"
          size="sm"
          variant={compare ? 'secondary' : 'ghost'}
          className="h-7 px-2 text-[11px]"
          disabled={!compareSrc || !src || running}
          onClick={() => setCompare((v) => !v)}
          title="A/B compare with previous"
        >
          <Columns2 className="mr-1 h-3 w-3" />
          A/B
        </Button>
      </div>

      <div
        ref={containerRef}
        className={cn(
          'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[16px] border border-border',
          CANVAS_BG[canvasBackground],
          dragOver && 'ring-2 ring-primary/50',
          spaceDown || panning ? 'cursor-grab' : 'cursor-default',
          panning && 'cursor-grabbing',
        )}
        data-canvas-background={canvasBackground}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {src ? (
          <div
            className="relative shrink-0 will-change-transform"
            style={{
              width: imgW,
              height: imgH,
              transform: `translate(${pan.x}px, ${pan.y}px)`,
            }}
          >
            {showCompare ? (
              <>
                <img
                  src={compareSrc!}
                  alt="Previous"
                  className="absolute inset-0 h-full w-full object-contain"
                  draggable={false}
                />
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ width: `${comparePct}%` }}
                >
                  <img
                    src={src}
                    alt="Current"
                    className="h-full max-w-none object-contain"
                    style={{ width: imgW, height: imgH }}
                    draggable={false}
                  />
                </div>
                <div
                  className="absolute inset-y-0 z-10 w-0.5 bg-primary shadow"
                  style={{ left: `${comparePct}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={comparePct}
                  onChange={(e) => setComparePct(Number(e.target.value))}
                  className="absolute inset-x-4 bottom-3 z-20 h-1 cursor-ew-resize accent-primary"
                  aria-label="A/B compare"
                />
              </>
            ) : (
              <img
                src={src}
                alt="Preview"
                className="h-full w-full object-contain"
                draggable={false}
              />
            )}
          </div>
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
        ) : emptyModelState ? (
          <div className="flex flex-col items-center gap-3 px-6 text-center text-muted-foreground">
            <ImageIcon className="h-12 w-12 opacity-40" />
            <div>
              <p className="text-sm font-medium text-foreground">Add a model</p>
              <p className="mt-1 max-w-xs text-xs opacity-70">
                Install a checkpoint or a diffusion stack to start generating.
              </p>
            </div>
            {onAddModel ? (
              <Button type="button" size="sm" onClick={onAddModel}>
                Add model
              </Button>
            ) : null}
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

        {src && (
          <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {Math.round(displayScale * 100)}%
            {spaceDown ? ' · pan' : ' · scroll zoom'}
          </p>
        )}
      </div>
    </div>
  );
}
