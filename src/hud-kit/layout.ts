// Logical geometry of the 640x480 HUD canvas. Mirrors the CSS variables in tokens.css
// (the test suite checks they agree). Source: docs/FRD-v2.2.md section 1.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CANVAS: Rect = { x: 0, y: 0, w: 640, h: 480 };
export const STATUS_STRIP: Rect = { x: 40, y: 0, w: 560, h: 80 };
export const BOTTOM_CARD: Rect = { x: 40, y: 300, w: 560, h: 140 };

/** ALWAYS EMPTY. The kit renders nothing inside this rect. */
export const CLEAR_ZONE: Rect = { x: 120, y: 90, w: 400, h: 200 };

export const CARD_PAD = { x: 16, y: 8 } as const;

/** Bottom card inner width: 560 - 2 * 16 = 528. */
export const CARD_INNER_WIDTH = BOTTOM_CARD.w - 2 * CARD_PAD.x;
