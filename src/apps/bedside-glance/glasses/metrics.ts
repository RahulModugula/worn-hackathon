// Advance widths of Nunito (variable, latin subset, public/fonts/Nunito-Variable.woff2) at the two weights the HUD uses,
// in 1/1000 em, for U+0020..U+007E then · … • – — ’ “ ”. copy.ts clips text by measured pixel width with this table,
// so no string relies on CSS ellipsis. copyAudit.test.ts re-reads the real font through fontkit and fails if any
// number here is off by more than 1 unit, so the table cannot drift from the font file.
const W600 = '264,237,417,600,600,937,708,231,336,336,452,600,237,429,237,297,600,600,600,600,600,600,600,600,600,600,237,237,600,600,600,450,948,736,682,676,751,589,554,731,767,268,338,643,552,861,743,775,642,775,677,622,611,733,700,1107,660,606,596,333,297,333,600,500,366,537,591,467,591,537,347,594,576,243,246,516,306,866,576,565,591,591,373,484,365,569,520,846,534,520,468,370,275,370,600,237,713,524,500,1000,237,416,416';
const W700 = '271,248,448,600,600,945,726,243,358,358,453,600,248,434,248,313,600,600,600,600,600,600,600,600,600,600,248,248,600,600,600,459,950,744,688,680,762,597,562,736,773,282,354,665,562,868,748,785,652,785,686,631,621,738,713,1113,672,618,605,354,313,354,600,500,377,547,600,472,600,542,364,604,585,255,259,536,319,877,585,576,600,600,392,488,384,579,527,853,546,526,474,391,288,391,600,248,745,524,500,1000,248,443,443';
const EXTRA = '·…•–—’“”';
const FALLBACK_EM = 0.9; // a character outside the table is assumed wider than any real one; the audit also fails on it

function table(csv: string): Map<string, number> {
  const m = new Map<string, number>();
  const chars = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).concat(Array.from(EXTRA));
  csv.split(',').forEach((n, i) => m.set(chars[i], Number(n)));
  return m;
}

export const ADVANCE: Record<600 | 700, Map<string, number>> = { 600: table(W600), 700: table(W700) };

/** Pixel width of `text` at `size` px and weight 600 or 700 (no letter-spacing is used on the HUD). */
export function measure(text: string, size: number, weight: 600 | 700): number {
  const t = ADVANCE[weight];
  let em = 0;
  for (const ch of Array.from(text)) em += (t.get(ch) ?? FALLBACK_EM * 1000) / 1000;
  return em * size;
}
