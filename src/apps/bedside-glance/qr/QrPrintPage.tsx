import { encodeQR } from 'qr';
import '../phone/tokens.css';
import { BrandMark } from '../phone/ui';

// Printable wristband-style QR sheet for the Bedside Glance demo (route: /qr).
// Each code is a Version 1 symbol, error correction L, drawn as SVG at 50 mm.
// A 10 mm white quiet zone surrounds each code. On screen the page uses the shared dark tokens;
// the white quiet zone is functional (scanners need contrast), and print goes to plain black on white.

export type QrCard = { payload: string; caption: string };

export const QR_CARDS: QrCard[] = [
  { payload: 'BG-P-1012', caption: 'Maria Lopez · Rm 12' },
  { payload: 'BG-P-1014', caption: 'James Carter · Rm 14' },
];

/** Dark-module grid for a payload. Version 1 = 21x21 modules. No built-in border. */
export function qrModules(payload: string): boolean[][] {
  // The encoder rejects border 0, so request the minimum border and slice it off.
  const withBorder = encodeQR(payload, 'raw', { ecc: 'low', version: 1, border: 1 });
  return withBorder.slice(1, -1).map((row) => row.slice(1, -1));
}

const CSS = `
.qr-page { min-height: 100vh; min-height: 100dvh; box-sizing: border-box; background: var(--bg); color: var(--fg); padding: calc(env(safe-area-inset-top) + var(--s-5)) var(--s-4) var(--s-7); font-family: var(--font-ui); }
.qr-head { display: flex; align-items: center; gap: var(--s-3); flex-wrap: wrap; max-width: 48rem; margin: 0 auto var(--s-5); }
.qr-head-text { flex: 1; min-width: 12rem; display: grid; gap: var(--s-1); }
.qr-title { margin: 0; font-size: var(--t-20); font-weight: var(--w-semibold); letter-spacing: -0.015em; }
.qr-hint { margin: 0; color: var(--fg-2); font-size: var(--t-14); }
.qr-print-btn { min-height: var(--tap); padding: 0 var(--s-5); border: 0; border-radius: var(--r-ctrl); background: var(--accent); color: var(--accent-ink); font: var(--w-semibold) var(--t-16) var(--font-ui); cursor: pointer; }
.qr-print-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.qr-sheet { display: flex; gap: var(--s-5); flex-wrap: wrap; justify-content: center; max-width: 48rem; margin: 0 auto; color: var(--fg); }
.qr-card { margin: 0; display: flex; flex-direction: column; align-items: center; border-radius: var(--r-card); background: var(--surface-1); padding: var(--s-3) var(--s-3) var(--s-4); }
.qr-quiet { background: #fff; padding: 10mm; border-radius: var(--r-ctrl); }
.qr-code { display: block; width: 50mm; height: 50mm; }
.qr-caption { margin-top: var(--s-3); font-size: var(--t-16); font-weight: var(--w-medium); text-align: center; }
@media print {
  .qr-page { background: #fff; }
  body * { visibility: hidden; }
  .qr-sheet, .qr-sheet * { visibility: visible; }
  .qr-sheet { position: absolute; left: 0; top: 0; gap: 10mm; justify-content: flex-start; color: #000; }
  .qr-card { background: #fff; padding: 0; }
  .qr-quiet { border-radius: 0; }
  .qr-caption { margin-top: 3mm; font-size: 12pt; font-weight: 400; }
  .qr-print-btn, .qr-head { display: none; }
  @page { margin: 10mm; }
}
`;

export function QrPrintPage() {
  return (
    <>
      <style>{CSS}</style>
      <div className="ph-app qr-page">
        <header className="qr-head">
          <BrandMark size={36} />
          <div className="qr-head-text">
            <h1 className="qr-title">Wristband codes</h1>
            <p className="qr-hint">Print at 100% scale on plain paper. Each code is 50 mm with a 10 mm quiet zone.</p>
          </div>
          <button type="button" className="qr-print-btn" onClick={() => window.print()}>
            Print
          </button>
        </header>
        <main className="qr-sheet">
          {QR_CARDS.map(({ payload, caption }) => {
            const modules = qrModules(payload);
            return (
              <figure className="qr-card" key={payload}>
                <div className="qr-quiet">
                  <svg
                    className="qr-code"
                    data-testid={`qr-${payload}`}
                    data-payload={payload}
                    viewBox={`0 0 ${modules.length} ${modules.length}`}
                    shapeRendering="crispEdges"
                    role="img"
                    aria-label={`QR code ${payload}`}
                  >
                    {modules.flatMap((row, y) =>
                      row.map((dark, x) =>
                        dark ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#000" /> : null,
                      ),
                    )}
                  </svg>
                </div>
                <figcaption className="qr-caption">{caption}</figcaption>
              </figure>
            );
          })}
        </main>
      </div>
    </>
  );
}

export default QrPrintPage;
