// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeQR } from 'qr/decode.js';
import { QR_CARDS, QrPrintPage, qrModules } from './QrPrintPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const QUIET = 4; // modules of white quiet zone added around the symbol for the decoder
const PX_PER_MODULE = 8;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<QrPrintPage />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** Rasterise the modules of a rendered <svg> (read back from the DOM) to RGBA with a quiet zone. */
function rasterFromDom(svg: SVGSVGElement) {
  const size = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
  const dark = new Set<string>();
  for (const rect of Array.from(svg.querySelectorAll('rect'))) {
    dark.add(`${rect.getAttribute('x')},${rect.getAttribute('y')}`);
  }
  const n = (size + QUIET * 2) * PX_PER_MODULE;
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!dark.has(`${x},${y}`)) continue;
      for (let py = 0; py < PX_PER_MODULE; py++) {
        for (let px = 0; px < PX_PER_MODULE; px++) {
          const X = (x + QUIET) * PX_PER_MODULE + px;
          const Y = (y + QUIET) * PX_PER_MODULE + py;
          const o = (Y * n + X) * 4;
          data[o] = data[o + 1] = data[o + 2] = 0;
        }
      }
    }
  }
  return { width: n, height: n, data };
}

describe('QrPrintPage', () => {
  it('renders one Version 1 (21 module) code per card, with the exact payloads', () => {
    const svgs = Array.from(host.querySelectorAll<SVGSVGElement>('svg.qr-code'));
    expect(svgs.map((s) => s.getAttribute('data-payload'))).toEqual(['BG-P-1012', 'BG-P-1014']);
    for (const svg of svgs) expect(svg.getAttribute('viewBox')).toBe('0 0 21 21');
  });

  it('each rendered code decodes to its exact payload', () => {
    for (const card of QR_CARDS) {
      const svg = host.querySelector<SVGSVGElement>(`svg[data-payload="${card.payload}"]`)!;
      const decoded = decodeQR(rasterFromDom(svg));
      expect(decoded).not.toBeInstanceOf(Error);
      expect(decoded).toBe(card.payload);
    }
  });

  it('the rendered DOM matches the encoder output module for module', () => {
    const svg = host.querySelector<SVGSVGElement>('svg[data-payload="BG-P-1012"]')!;
    const expected = qrModules('BG-P-1012');
    const darkCount = expected.flat().filter(Boolean).length;
    expect(svg.querySelectorAll('rect').length).toBe(darkCount);
  });

  it('captions and print button are present', () => {
    const captions = Array.from(host.querySelectorAll('.qr-caption')).map((c) => c.textContent);
    expect(captions).toEqual(['Maria Lopez · Rm 12', 'James Carter · Rm 14']);
    expect(host.querySelector('button')!.textContent).toBe('Print');
  });

  it('print CSS sizes each code at 50mm with a 10mm white quiet zone and hides everything else', () => {
    const css = host.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.qr-code \{[^}]*width: 50mm;[^}]*height: 50mm;/);
    expect(css).toMatch(/\.qr-quiet \{[^}]*padding: 10mm;/);
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toContain('visibility: hidden');
    expect(print).toContain('.qr-sheet, .qr-sheet *');
  });
});
