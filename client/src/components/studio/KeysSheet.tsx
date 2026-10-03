import { useEffect } from 'react';
import { X } from 'lucide-react';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = MAC ? '⌘' : 'Ctrl';

type Row = [string, ...string[]];
const GROUPS: Array<{ name: string; rows: Row[] }> = [
  {
    name: 'Studio',
    rows: [
      ['Generate (adds to the queue)', MOD, '↵'],
      ['Stop the current image', 'Esc'],
      ['Show or hide the controls', MOD, '\\'],
      ['Image details', 'I'],
      ['Compare before / after', 'C'],
      ['Pin the selected image', 'F'],
      ['Delete the selected image', 'Del'],
      ['This list', '?'],
    ],
  },
  {
    name: 'Image plane',
    rows: [
      ['Previous / next image', '←', '→'],
      ['Previous / next generation', '↑', '↓'],
      ['Zoom', 'Scroll'],
      ['Zoom (trackpad)', 'Pinch'],
      ['Pan', 'Drag'],
      ['Pan (trackpad)', 'Two fingers'],
      ['Fit an image', 'Double-click'],
      ['Fit the selected image', '1'],
      ['Show everything', '0'],
      ['Image actions', 'Right-click'],
    ],
  },
  {
    name: 'Prompt',
    rows: [
      ['Choose a suggestion', '↑', '↓'],
      ['Insert the suggestion', 'Tab'],
      ['Close suggestions', 'Esc'],
    ],
  },
  {
    name: 'History',
    rows: [
      ['Add to the selection', MOD, 'Click'],
      ['Select a range', '⇧', 'Click'],
      ['Finish selecting', 'Esc'],
    ],
  },
  {
    name: 'Mask editor · tools',
    rows: [
      ['Brush', 'B'],
      ['Eraser', 'E'],
      ['Fill', 'F'],
      ['Extend / shift edges', 'R'],
      ['Brush size', '[', ']'],
    ],
  },
  {
    name: 'Mask editor · edit and view',
    rows: [
      ['Undo', MOD, 'Z'],
      ['Redo', MOD, '⇧', 'Z'],
      ['Zoom in / out', MOD, '+', '−'],
      ['Fit to screen', MOD, '0'],
      ['Pan', 'Space', 'Drag'],
      ['Add to references', MOD, '↵'],
      ['Close without saving', 'Esc'],
    ],
  },
];

/** Every keyboard shortcut, grouped. Opens with ? (or from Preferences). */
export function KeysSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="st-keys" role="dialog" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="st-scroll st-keys-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-[18px] flex items-center justify-between">
          <span className="text-xl font-semibold">Keyboard shortcuts</span>
          <button type="button" className="st-ibtn" onClick={onClose} aria-label="Close" data-tip="Close  ·  Esc">
            <X />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-9 gap-y-[22px]">
          {GROUPS.map((g) => (
            <div key={g.name} className="flex flex-col gap-0.5">
              <div className="st-sec pb-1.5">{g.name}</div>
              {g.rows.map(([what, ...keys]) => (
                <div key={what} className="flex min-h-8 items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--s-line)' }}>
                  <span className="text-[13.5px]">{what}</span>
                  <span className="flex shrink-0 gap-1">
                    {keys.map((k) => (
                      <span key={k} className="st-kbd">{k}</span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
