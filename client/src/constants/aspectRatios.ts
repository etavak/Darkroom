/** Aspect ratios at reference 1024 — scale with family baseRes. */
export const ASPECT_RATIO_REF = [
  { id: '1:1', label: '1:1', width: 1024, height: 1024 },
  { id: '3:4', label: '3:4', width: 896, height: 1152 },
  { id: '4:3', label: '4:3', width: 1152, height: 896 },
  { id: '2:3', label: '2:3', width: 832, height: 1216 },
  { id: '3:2', label: '3:2', width: 1216, height: 832 },
  { id: '9:16', label: '9:16', width: 768, height: 1344 },
  { id: '16:9', label: '16:9', width: 1344, height: 768 },
] as const;

export function round64(n: number): number {
  return Math.max(64, Math.round(n / 64) * 64);
}

export function scaleAspectPresets(baseRes: number) {
  const scale = baseRes / 1024;
  return ASPECT_RATIO_REF.map((p) => ({
    id: p.id,
    label: p.label,
    width: round64(p.width * scale),
    height: round64(p.height * scale),
  }));
}
