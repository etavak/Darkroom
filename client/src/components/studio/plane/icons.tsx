import type { ReactNode, SVGProps } from 'react';

/** The design's own toolbar icons (24×24, stroked, currentColor). */
function Icon({ children, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export const EnhanceIcon = () => (
  <Icon>
    <path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z" />
    <path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
  </Icon>
);

export const VaryIcon = () => (
  <Icon>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <path d="M17 14v6M14 17h6" />
  </Icon>
);

export const UpscaleIcon = () => (
  <Icon>
    <rect x="4" y="11" width="9" height="9" rx="1.5" />
    <path d="M14 4h6v6M20 4l-7 7" />
  </Icon>
);

export const UseAsBaseIcon = () => (
  <Icon>
    <rect x="3" y="5" width="13" height="13" rx="2.5" />
    <path d="m3 15 4-4 4 4M14 12h7M18 9l3 3-3 3" />
  </Icon>
);

export const EditIcon = () => (
  <Icon>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="m13 7 4 4" />
    <path d="M19 15l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" />
  </Icon>
);

export const InpaintIcon = () => (
  <Icon>
    <path d="M18 3l3 3-9 9-4 1 1-4z" />
    <path d="M7 17c-2 0-3 1.5-3 4 2.5 0 4-1 4-3" />
  </Icon>
);

export const PinIcon = ({ filled, ...rest }: { filled?: boolean } & SVGProps<SVGSVGElement>) => (
  <Icon fill={filled ? 'currentColor' : 'none'} {...rest}>
    <path d="M15 3 21 9l-3 1-4 4 .5 4.5L13 20l-4-4-5 5-1-1 5-5-4-4 1.5-1.5L10 10l4-4z" />
  </Icon>
);

export const CopyImageIcon = () => (
  <Icon>
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <path d="M16 5h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2" />
    <path d="m8 16 3-3 2 2 3-3" />
  </Icon>
);

export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
);

export const SeedIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M12 21V11M12 11c0-4 3-6 7-6 0 4-3 6-7 6zM12 14c0-3-2-5-6-5 0 3 2 5 6 5z" />
  </Icon>
);

export const CopyIcon = () => (
  <Icon>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </Icon>
);

export const CompareIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M12 3v18" />
    <path d="m8 10-2 2 2 2M16 10l2 2-2 2" />
  </Icon>
);
