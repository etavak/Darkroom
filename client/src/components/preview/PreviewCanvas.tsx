import { imageUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

type Props = {
  previewUrl: string | null;
  resultImages: string[];
  running: boolean;
  width: number;
  height: number;
};

export function PreviewCanvas({ previewUrl, resultImages, running, width, height }: Props) {
  const primary = resultImages[0] ? imageUrl(resultImages[0]) : null;
  const displaySrc = running && previewUrl ? previewUrl : primary;

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3">
      <div
        className={cn(
          'relative flex max-h-full items-center justify-center overflow-hidden rounded-lg border bg-card transition-[aspect-ratio,width] duration-300 ease-out',
        )}
        style={{
          aspectRatio: `${width} / ${height}`,
          width: 'min(100%, 720px)',
          maxHeight: '100%',
        }}
      >
        {displaySrc ? (
          <img
            src={displaySrc}
            alt={running ? 'Live preview' : 'Generated image'}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 px-8 text-center text-muted-foreground">
            <p className="text-sm font-medium tracking-wide text-foreground">Darkroom</p>
            <p className="text-xs">Enter a prompt and generate</p>
          </div>
        )}
        {running && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        )}
      </div>

      {resultImages.length > 1 && !running && (
        <div className="flex max-w-full gap-2 overflow-x-auto px-2">
          {resultImages.map((filename) => (
            <img
              key={filename}
              src={imageUrl(filename)}
              alt=""
              className="h-16 w-16 shrink-0 rounded border object-cover"
            />
          ))}
        </div>
      )}
    </div>
  );
}
