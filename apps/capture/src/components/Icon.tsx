// Inline SVG icon set matching the design handoff. Stroke icons inherit `currentColor`
// (1.8px rounded by default); a few are solid fills. Keep shapes identical to the
// prototype so the re-skin is faithful.
import type { CSSProperties } from 'react';

export type IconName =
  | 'camera'
  | 'mic'
  | 'cloud'
  | 'trash'
  | 'chevronRight'
  | 'chevronLeft'
  | 'pin' // location pin (outline, for area chips)
  | 'sparkle'
  | 'send'
  | 'upload'
  | 'check'
  | 'sun'
  | 'moon'
  | 'x'
  | 'doc'
  | 'alert'
  | 'play'
  | 'drive'
  | 'edit'
  | 'home';

const FILLED = new Set<IconName>(['sparkle', 'moon', 'play']);

const PATHS: Record<IconName, JSX.Element> = {
  camera: (
    <>
      <path d="M3 8.5A2 2 0 0 1 5 6.5h1.3l.8-1.6a1 1 0 0 1 .9-.5h6.4a1 1 0 0 1 .9.5l.8 1.6H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="13" r="3.3" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  cloud: (
    <>
      <path d="M7 18a4 4 0 0 1 0-8 5.2 5.2 0 0 1 9.8-1.4A3.6 3.6 0 0 1 18 18H7Z" />
      <path d="M12 14.5v-5M9.6 11.4 12 9l2.4 2.4" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  pin: (
    <>
      <path d="M12 21c4-4.5 6.5-7.3 6.5-10.5A6.5 6.5 0 1 0 5.5 10.5C5.5 13.7 8 16.5 12 21Z" />
      <circle cx="12" cy="10.5" r="2.2" />
    </>
  ),
  sparkle: <path d="M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9L12 16.5l-1.9-5.1L5 9.5l5.1-1.9Z" />,
  send: <path d="M21 3 10.5 13.5M21 3l-6.5 18-4-8-8-4L21 3Z" />,
  upload: <path d="M12 16V4M8 8l4-4 4 4M5 20h14" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.2 8.2 0 0 1 9.4 4 7 7 0 1 0 20 14.5Z" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  doc: (
    <>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2 21h20L12 3Z" />
      <path d="M12 10v4M12 17.5v.01" />
    </>
  ),
  play: <path d="M8 5l11 7-11 7Z" />,
  drive: (
    <>
      <path d="M5 13a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2" />
      <path d="M7 9h.01M7 17h10a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v0a2 2 0 0 1 2-2Z" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L18 10l-4-4L4 16v4Z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  home: <path d="M12 16V4M8 8l4-4 4 4M5 20h14" />,
};

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 20, strokeWidth = 1.8, className, style }: IconProps) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? undefined : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

interface LogoProps {
  size?: number;
  /** Pin body fill. */
  fill?: string;
  /** The three vertical bars inside the pin. */
  ink?: string;
  className?: string;
  style?: CSSProperties;
}

/** The FieldReport waypoint-pin logomark (two-tone). Placeholder brand mark. */
export function Logo({ size = 24, fill = 'currentColor', ink = '#fff', className, style }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M12 22c5-5.6 8-9.3 8-13a8 8 0 1 0-16 0c0 3.7 3 7.4 8 13Z" fill={fill} />
      <path d="M9 9.4v4.6M12 7.6v8.2M15 9.4v4.6" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
