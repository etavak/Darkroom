/** Darkroom's mark: an amber ring with a dot (aperture). */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--s-accent)" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.2" fill="var(--s-accent)" />
    </svg>
  );
}
