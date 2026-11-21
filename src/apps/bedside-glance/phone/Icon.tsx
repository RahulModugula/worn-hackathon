import type { ReactNode } from 'react';

/**
 * One inline-SVG icon set: 24px grid, 1.75px stroke, round caps and joins (Lucide-style geometry, ISC).
 * `filled` tints the closed shapes (used by the active tab); open strokes stay line-only.
 * Icons are decorative: pair them with a word, or give the button an aria-label.
 */
export type IconName =
  | 'clock' | 'user' | 'wound' | 'activity' | 'bolt' | 'help' | 'glasses' | 'phone' | 'wifi' | 'wifi-off'
  | 'allergy' | 'check' | 'check-circle' | 'pill' | 'x' | 'undo' | 'camera' | 'mic' | 'send' | 'save'
  | 'retry' | 'chevron' | 'scan' | 'alert' | 'info' | 'image' | 'copy';

type Shape = { fill?: boolean; node: ReactNode };

const S = (node: ReactNode, fill = false): Shape => ({ node, fill });

const SHAPES: Record<IconName, Shape[]> = {
  clock: [S(<circle cx="12" cy="12" r="9" />, true), S(<path d="M12 7v5l3 2" />)],
  user: [S(<circle cx="12" cy="8" r="4" />, true), S(<path d="M4.5 20.5c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6z" />, true)],
  wound: [
    S(<rect x="1.5" y="8" width="21" height="8" rx="4" transform="rotate(-45 12 12)" />, true),
    S(<rect x="9" y="9" width="6" height="6" rx="1" transform="rotate(-45 12 12)" />),
    S(<path d="M11 12h.01M13 12h.01" />),
  ],
  activity: [S(<path d="M3 12h4l3-8 4 16 3-8h4" />)],
  bolt: [S(<path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z" />, true)],
  help: [S(<circle cx="12" cy="12" r="9" />), S(<path d="M9.6 9.6a2.5 2.5 0 0 1 4.9.4c0 1.7-2.5 2-2.5 3.7" />), S(<path d="M12 17.2v.01" />)],
  glasses: [S(<circle cx="6.5" cy="14.5" r="3.5" />), S(<circle cx="17.5" cy="14.5" r="3.5" />), S(<path d="M10 14.5h4M3.2 13l1.6-6.5M20.8 13l-1.6-6.5" />)],
  phone: [S(<rect x="7" y="2.5" width="10" height="19" rx="2.5" />, true), S(<path d="M11 18.5h2" />)],
  wifi: [S(<path d="M4.5 10a11 11 0 0 1 15 0M7.5 13.2a6.6 6.6 0 0 1 9 0" />), S(<path d="M12 17v.01" />)],
  'wifi-off': [S(<path d="M4.5 10a11 11 0 0 1 3-2M12 5.5a11 11 0 0 1 7.5 3M9 13.4a6.6 6.6 0 0 1 3-1.4M15 13.4a6.8 6.8 0 0 0-1-.7" />), S(<path d="M12 17v.01M3.5 3.5l17 17" />)],
  allergy: [S(<path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" />, true), S(<path d="M12 8v4.5M12 16v.01" />)],
  check: [S(<path d="M5 12.5l4.5 4.5L19 7.5" />)],
  'check-circle': [S(<circle cx="12" cy="12" r="9" />, true), S(<path d="M8 12.3l3 3 5-6" />)],
  pill: [S(<path d="M10.6 20.4a5 5 0 0 1-7-7l9.8-9.8a5 5 0 0 1 7 7z" />, true), S(<path d="M8.6 8.6l6.8 6.8" />)],
  x: [S(<path d="M6 6l12 12M18 6L6 18" />)],
  undo: [S(<path d="M9 14L4 9l5-5" />), S(<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />)],
  camera: [S(<path d="M4 8h3l1.6-2.5h6.8L17 8h3v11H4z" />, true), S(<circle cx="12" cy="13.5" r="3.5" />)],
  mic: [S(<rect x="9" y="3" width="6" height="11" rx="3" />, true), S(<path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />)],
  send: [S(<path d="M21 3L10.5 13.5" />), S(<path d="M21 3l-6.5 18-4-7.5L3 9.5z" />, true)],
  save: [S(<path d="M5 3h11l3 3v15H5z" />, true), S(<path d="M8 3v5h7V3M8 21v-6h8v6" />)],
  retry: [S(<path d="M20 12a8 8 0 1 1-2.6-5.9" />), S(<path d="M20 4v5h-5" />)],
  chevron: [S(<path d="M9 5l7 7-7 7" />)],
  scan: [S(<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />), S(<circle cx="12" cy="12" r="1.6" />, true)],
  alert: [S(<path d="M12 3.5l9.5 16.5h-19z" />, true), S(<path d="M12 10v4.5M12 17.5v.01" />)],
  info: [S(<circle cx="12" cy="12" r="9" />, true), S(<path d="M12 11v5.5M12 7.5v.01" />)],
  image: [S(<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />, true), S(<path d="M3.5 16l5-5 4.5 4.5 2.5-2.5 5 5" />)],
  copy: [S(<rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />, true), S(<path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />)],
};

export interface IconProps {
  name: IconName;
  filled?: boolean;
  size?: number;
  className?: string;
}

export function Icon({ name, filled = false, size = 24, className }: IconProps) {
  return (
    <svg
      className={className ? `ph-icon ${className}` : 'ph-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name].map((s, i) => (
        <g key={i} fill={filled && s.fill ? 'currentColor' : 'none'} fillOpacity={filled && s.fill ? 0.28 : undefined}>
          {s.node}
        </g>
      ))}
    </svg>
  );
}
