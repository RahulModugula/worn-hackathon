export type HudIconName =
  | 'dot' | 'ring' | 'diamond' | 'triangle' | 'check' | 'link' | 'link-off' | 'mic' | 'scan';

/**
 * 24x24 FILLED flat shapes; every stroke is at least 2px. Meaning rides on the shape, never on color alone:
 * filled disc = done, ring = pending, filled diamond = alert, triangle = warning, mic = live input.
 * Black cut-outs (evenodd) are see-through on the waveguide. Drawn with currentColor.
 */
const PATHS: Record<HudIconName, string> = {
  dot: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  ring: 'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zm0 3a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z',
  diamond: 'M12 1l11 11-11 11L1 12zM10.75 6h2.5v7h-2.5zm0 8.75h2.5v2.5h-2.5z',
  triangle: 'M12 2.5l10.5 18.5h-21zM10.75 9h2.5v6h-2.5zm0 7.25h2.5v2.5h-2.5z',
  check: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.6 13.9L6.2 11.7l1.9-1.9 2.3 2.3 5.5-5.5 1.9 1.9z',
  link: 'M7 2h10a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zm0 3v11h10V5zM10.5 18h3v2h-3z',
  'link-off': 'M7 2h10a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zm0 3v11h10V5zM10.5 18h3v2h-3zM3 5.1L5.1 3 21 18.9 18.9 21z',
  mic: 'M12 1.5a3.75 3.75 0 0 1 3.75 3.75v5.5a3.75 3.75 0 0 1-7.5 0v-5.5A3.75 3.75 0 0 1 12 1.5zM4.5 10h2.5a5 5 0 0 0 10 0h2.5a7.5 7.5 0 0 1-6.25 7.4V21h-2.5v-3.6A7.5 7.5 0 0 1 4.5 10z',
  scan: 'M2 2h7v2.5H4.5V9H2zM15 2h7v7h-2.5V4.5H15zM2 15h2.5v4.5H9V22H2zM19.5 15H22v7h-7v-2.5h4.5zM12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z',
};

export function Icon({ name, size }: { name: HudIconName; size?: number }) {
  return (
    <svg className="hud-icon" width={size} height={size} style={size ? { width: size + 'px', height: size + 'px' } : undefined} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon={name}>
      <path d={PATHS[name]} fillRule="evenodd" />
    </svg>
  );
}
