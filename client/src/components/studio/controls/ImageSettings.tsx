import { useState } from 'react';
import { ArrowLeftRight, ChevronDown } from 'lucide-react';
import type { AspectPreset } from '@/types/presets';
import { StMenuButton, StMenuItem, StSeg } from './primitives';

type Orient = 'landscape' | 'portrait' | 'square';

type Props = {
  /** The family's ratio presets at its native resolution (landscape) */
  presets: AspectPreset[];
  width: number;
  height: number;
  aspectId: string;
  onSize: (width: number, height: number, aspectId: string) => void;
  batch: number;
  onBatch: (n: number) => void;
  /** Width/height step for custom sizes */
  sizeMultiple: number;
  disabled?: boolean;
};

const orientOf = (w: number, h: number): Orient => (w === h ? 'square' : w > h ? 'landscape' : 'portrait');

function OrientIcon({ w, h }: { w: number; h: number }) {
  return <span className="block rounded-[3px]" style={{ width: w, height: h, border: '1.8px solid currentColor' }} />;
}

/** Custom width × height, opened from the resolution chip. */
function SizeEditor({ width, height, step, onApply }: { width: number; height: number; step: number; onApply: (w: number, h: number) => void }) {
  const [w, setW] = useState(String(width));
  const [h, setH] = useState(String(height));
  const snap = (v: string) => Math.min(4096, Math.max(step * 8, Math.round((Number(v) || 0) / step) * step));
  const apply = () => onApply(snap(w), snap(h));
  return (
    <div className="flex flex-col gap-2.5 p-1.5">
      <span className="st-lbl text-[12.5px]">Custom size · steps of {step}px</span>
      <div className="flex items-center gap-1.5">
        <input className="st-search st-mono h-9 w-0 min-w-0 flex-1 text-center" inputMode="numeric" value={w} onChange={(e) => setW(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} aria-label="Width" />
        <span style={{ color: 'var(--s-faint)' }}>×</span>
        <input className="st-search st-mono h-9 w-0 min-w-0 flex-1 text-center" inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} aria-label="Height" />
        <button
          type="button"
          className="st-ibtn h-9 w-9"
          onClick={() => {
            setW(h);
            setH(w);
            onApply(snap(h), snap(w));
          }}
          aria-label="Swap width and height"
          data-tip="Swap width and height"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Resolution, ratio + orientation, and how many images per Generate. */
export function ImageSettings({ presets, width, height, aspectId, onSize, batch, onBatch, sizeMultiple, disabled }: Props) {
  const orient = orientOf(width, height);
  const preset = presets.find((p) => p.id === aspectId);
  const custom = !preset;
  const wide = presets.filter((p) => p.width !== p.height);
  const square = presets.find((p) => p.width === p.height);
  // The ratio Landscape/Portrait use when coming from Square
  const [lastRatio, setLastRatio] = useState('3:2');

  const pick = (p: AspectPreset, o: Orient) => {
    if (p.width !== p.height) setLastRatio(p.id);
    if (o === 'portrait' && p.width !== p.height) onSize(p.height, p.width, p.id);
    else onSize(p.width, p.height, p.id);
  };
  const setOrient = (o: Orient) => {
    if (o === 'square') {
      if (square) pick(square, 'square');
      else onSize(Math.min(width, height), Math.min(width, height), 'custom');
      return;
    }
    const base = preset && preset.width !== preset.height ? preset : wide.find((p) => p.id === lastRatio) ?? wide[0];
    if (base) pick(base, o);
    else if (orientOf(width, height) !== o) onSize(height, width, 'custom');
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-[15px] font-semibold">Resolution</span>
        <StMenuButton
          tip="Output size in pixels — click for a custom size"
          label={`Resolution ${width} by ${height}`}
          disabled={disabled}
          direction="auto"
          menuStyle={{ left: 'auto', right: 0, width: 260 }}
          button={
            <span
              className="st-mono inline-flex h-[34px] items-center gap-2 rounded-lg px-3 text-[13px]"
              style={{ background: 'var(--s-panel)', border: '1px solid var(--s-line)', cursor: 'pointer' }}
            >
              {width}
              <span style={{ color: 'var(--s-faint)' }}>×</span>
              {height}
            </span>
          }
        >
          <SizeEditor key={`${width}x${height}`} width={width} height={height} step={sizeMultiple} onApply={(w, h) => onSize(w, h, 'custom')} />
        </StMenuButton>
      </div>
      <div className="flex gap-2">
        <StMenuButton
          className="w-[120px] shrink-0"
          tip="Shape — sizes are scaled to this model's native resolution"
          label="Shape"
          disabled={disabled}
          direction="auto"
          menuStyle={{ left: 0, width: 220 }}
          button={
            <span className="st-chip h-12 w-full">
              <span className="st-mono">{custom ? 'Custom' : preset.label}</span>
              <ChevronDown className="h-4 w-4" style={{ color: 'var(--s-muted)' }} />
            </span>
          }
        >
          {(close) =>
            presets.map((p) => {
              const o = p.width === p.height ? 'square' : orient === 'portrait' ? 'portrait' : 'landscape';
              const [w, h] = o === 'portrait' ? [p.height, p.width] : [p.width, p.height];
              return (
                <StMenuItem
                  key={p.id}
                  title={p.label}
                  detail={`${w} × ${h}`}
                  selected={p.id === aspectId}
                  onClick={() => {
                    pick(p, o);
                    close();
                  }}
                />
              );
            })
          }
        </StMenuButton>
        <div className="min-w-0 flex-1">
          <StSeg
            value={orient}
            onChange={setOrient}
            disabled={disabled}
            options={[
              { value: 'landscape', label: <OrientIcon w={22} h={14} />, tip: 'Landscape', aria: 'Landscape' },
              { value: 'portrait', label: <OrientIcon w={14} h={22} />, tip: 'Portrait', aria: 'Portrait' },
              { value: 'square', label: <OrientIcon w={18} h={18} />, tip: 'Square', aria: 'Square' },
            ]}
          />
        </div>
      </div>
      <div className="px-0.5 pt-1.5 text-[15px] font-semibold">Number of images</div>
      <StSeg
        value={batch}
        onChange={onBatch}
        disabled={disabled}
        options={[1, 2, 3, 4].map((n) => ({
          value: n,
          label: <span className="st-mono">{n}</span>,
          tip: `Make ${n} image${n > 1 ? 's' : ''} per Generate`,
        }))}
      />
    </>
  );
}
