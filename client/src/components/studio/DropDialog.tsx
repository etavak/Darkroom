import { useEffect } from 'react';

export type DropTarget = 'base' | 'cn' | 'reuse';

const TARGETS: Array<{ id: DropTarget; name: string; desc: string; icon: string }> = [
  { id: 'base', name: 'Use as base image', desc: 'Image to image — restyle, edit, inpaint or extend it', icon: 'M4 6h12v12H4zM8 21h11a2 2 0 0 0 2-2V8M4 15l4-4 4 4' },
  { id: 'cn', name: 'Use as a guide', desc: 'ControlNet — copy its pose, depth or edges', icon: 'M12 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 7v6M7 10l5 3 5-3M9 21l3-8 3 8' },
  { id: 'reuse', name: 'Reuse its settings', desc: 'Load the prompt and settings saved in a Darkroom PNG', icon: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4' },
];

type Props = {
  via: 'drop' | 'paste';
  name: string | null;
  /** Only PNGs can carry Darkroom settings */
  png: boolean;
  /** Target under the pointer while dragging */
  over: DropTarget | null;
  guideAvailable: boolean;
  onPick: (t: DropTarget) => void;
  onCancel: () => void;
};

/**
 * Shown while a file is dragged over the studio (drop it on a target) or after pasting an
 * image (click a target). Dropping anywhere else uses it as the base image.
 */
export function DropDialog({ via, name, png, over, guideAvailable, onPick, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div className="st-drop" role="dialog" aria-label="Use this image" onClick={onCancel}>
      <div className="flex flex-col items-center gap-[18px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center gap-1 text-white">
          <span className="text-[19px] font-semibold">{via === 'paste' ? 'Use the pasted image' : 'Drop to use this image'}</span>
          <span className="st-mono text-[12.5px] opacity-70">{name ?? 'Image file'}</span>
        </div>
        <div className="flex gap-3.5">
          {TARGETS.map((t) => {
            const disabled = (t.id === 'reuse' && !png) || (t.id === 'cn' && !guideAvailable);
            const desc =
              t.id === 'reuse' && !png ? 'Only Darkroom PNGs carry settings' : t.id === 'cn' && !guideAvailable ? 'ControlNet isn’t available in this ComfyUI' : t.desc;
            return (
              <button
                key={t.id}
                type="button"
                data-drop={t.id}
                className={`st-droptarget ${over === t.id ? 'on' : ''}`}
                disabled={disabled}
                onClick={() => onPick(t.id)}
              >
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={t.icon} />
                </svg>
                <span className="text-[15px] font-semibold">{t.name}</span>
                <span className="text-[12.5px] leading-snug opacity-75">{desc}</span>
              </button>
            );
          })}
        </div>
        {via === 'paste' ? (
          <button type="button" className="st-pill" onClick={onCancel}>
            Cancel  ·  Esc
          </button>
        ) : null}
      </div>
    </div>
  );
}
