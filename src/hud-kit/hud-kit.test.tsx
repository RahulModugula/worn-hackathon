import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Canvas } from './components/Canvas';
import { Body, Hero, Hint, Label, Meta } from './components/Typography';
import { Icon } from './components/Icon';
import { ProgressBar, Steps } from './components/Progress';
import { CornerBrackets } from './components/CornerBrackets';
import { StatusStrip } from './components/StatusStrip';
import { BOTTOM_CARD, CARD_INNER_WIDTH, CARD_PAD, CLEAR_ZONE, STATUS_STRIP } from './layout';

// Read the CSS as text (vitest returns ?raw CSS imports empty).
const tokensCss = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
const hudCss = readFileSync(join(import.meta.dirname, 'hud-kit.css'), 'utf8');

// jsdom has no layout engine and drops declarations that use var(), so the test
// inlines the geometry/type tokens from the :root block before injecting the CSS.
// Theme colors are checked against the token blocks directly.
function declaredVars(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

function tokenBlock(css: string, selector: string): string {
  const re = new RegExp(`(?:^|\\n)${selector.replace(/[[\]"()]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  return re.exec(css)?.[1] ?? '';
}

const geometry = declaredVars(tokenBlock(tokensCss, ':root'));

function inlineGeometry(css: string): string {
  return css.replace(/var\((--[\w-]+)\)/g, (m, name: string) => geometry[name] ?? m);
}

function computed(el: Element, prop: string): string {
  const kebab = prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return getComputedStyle(el).getPropertyValue(kebab).trim();
}

const px = (s: string): number => parseFloat(s);

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = inlineGeometry(tokensCss + hudCss);
  document.head.appendChild(style);
});

afterEach(() => {
  cleanup();
});

describe('canvas', () => {
  it('is exactly 640x480, black, clipped, with Nunito', () => {
    const { container } = render(<Canvas />);
    const el = container.querySelector('[data-hud="canvas"]')!;
    expect(computed(el, 'width')).toBe('640px');
    expect(computed(el, 'height')).toBe('480px');
    expect(computed(el, 'backgroundColor')).toMatch(/^(#000|#000000|rgb\(0, 0, 0\))$/);
    expect(computed(el, 'overflow')).toBe('hidden');
    expect(computed(el, 'fontFamily')).toContain('Nunito');
  });

  it('green is the default theme; color theme sets white / amber / red', () => {
    const green = tokenBlock(tokensCss, ':root,\\n[data-theme="green"]');
    expect(declaredVars(green)['--hud-fg'].toLowerCase()).toBe('#78ee8a');
    const color = declaredVars(tokenBlock(tokensCss, '[data-theme="color"]'));
    expect(color['--hud-fg'].toLowerCase()).toBe('#ffffff');
    expect(color['--hud-accent'].toLowerCase()).toBe('#ffc24b');
    expect(color['--hud-alert'].toLowerCase()).toBe('#ff5c5c');
    // The default theme is applied to the canvas on render.
    const { container } = render(<Canvas />);
    expect(container.querySelector('[data-hud="canvas"]')!.getAttribute('data-theme')).toBe('green');
  });
});

describe('typography: heavy rounded sans, sentence case, luminance ladder (docs/DESIGN-SYSTEM.md section 4)', () => {
  const cases = [
    { name: 'Label', C: Label, size: 20, weight: '700', opacity: '1' },
    { name: 'Hero', C: Hero, size: 36, weight: '700', opacity: '1' },
    { name: 'Body', C: Body, size: 22, weight: '600', opacity: '0.75' },
    { name: 'Hint', C: Hint, size: 20, weight: '600', opacity: '0.75' },
    { name: 'Meta', C: Meta, size: 20, weight: '600', opacity: '0.6' },
  ] as const;

  for (const c of cases) {
    it(`${c.name}: size, weight, opacity, sentence case, no tracking, one-line ellipsis, >= 18px, >= 40% luminance`, () => {
      const { container } = render(<c.C>Sample</c.C>);
      const el = container.querySelector('.hud-text')!;
      expect(px(computed(el, 'fontSize'))).toBe(c.size);
      expect(px(computed(el, 'fontSize'))).toBeGreaterThanOrEqual(18);
      expect(computed(el, 'fontWeight')).toBe(c.weight);
      expect(computed(el, 'opacity')).toBe(c.opacity);
      expect(parseFloat(c.opacity)).toBeGreaterThanOrEqual(0.4);
      expect(computed(el, 'textTransform')).toBe('none');
      expect(px(computed(el, 'letterSpacing'))).toBe(0);
      expect(computed(el, 'whiteSpace')).toBe('nowrap');
      expect(computed(el, 'overflow')).toBe('hidden');
      expect(computed(el, 'textOverflow')).toBe('ellipsis');
    });
  }

  it('the kit never uppercases, tracks out, glows, blurs, shades or uses a monospace face', () => {
    const stripped = hudCss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\.hud-preview[^{]*\{[^}]*\}|\.hud-index[^{]*\{[^}]*\}/g, '');
    expect(stripped).not.toMatch(/text-transform:\s*uppercase|box-shadow|text-shadow|filter:|backdrop-filter|gradient|monospace/);
    expect(stripped).not.toMatch(/letter-spacing:\s*[^0;\s]/);
  });

  it('a line with an icon and an aside keeps text first and renders both', () => {
    const { container } = render(<Label icon="diamond" aside="Aside text" asideIcon="ring">State</Label>);
    expect(container.querySelector('.hud-line')).not.toBeNull();
    expect(container.querySelector('.hud-line__icon [data-icon="diamond"]')).not.toBeNull();
    expect(container.querySelector('.hud-line__text')!.textContent).toBe('State');
    expect(container.querySelector('.hud-line__aside')!.textContent).toBe('Aside text');
    expect(container.querySelector('.hud-line__aside [data-icon="ring"]')).not.toBeNull();
  });
});

describe('icons and progress', () => {
  it('icons are 24x24 filled shapes drawn with currentColor (no outline-only strokes)', () => {
    const { container } = render(<Icon name="diamond" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(px(computed(svg, 'width'))).toBe(24);
    expect(px(computed(svg, 'height'))).toBe(24);
    expect(svg.querySelector('path')!.getAttribute('stroke')).toBeNull();
  });
  it('progress bar clamps to 0..100% and the stepper fills up to the index', () => {
    const { container, rerender } = render(<ProgressBar fraction={1.7} />);
    expect(container.querySelector('.hud-bar__fill')!.getAttribute('style')).toContain('width: 100%');
    rerender(<ProgressBar fraction={0.25} />);
    expect(container.querySelector('.hud-bar__fill')!.getAttribute('style')).toContain('width: 25%');
    const steps = render(<Steps total={3} index={1} />).container;
    expect(steps.querySelectorAll('.hud-steps__dot')).toHaveLength(3);
    expect(steps.querySelectorAll('.hud-steps__dot--on')).toHaveLength(2);
  });
});

describe('zones and card', () => {
  it('CSS tokens agree with layout constants', () => {
    expect(px(geometry['--hud-clear-x'])).toBe(CLEAR_ZONE.x);
    expect(px(geometry['--hud-clear-y'])).toBe(CLEAR_ZONE.y);
    expect(px(geometry['--hud-clear-w'])).toBe(CLEAR_ZONE.w);
    expect(px(geometry['--hud-clear-h'])).toBe(CLEAR_ZONE.h);
    expect(px(geometry['--hud-status-x'])).toBe(STATUS_STRIP.x);
    expect(px(geometry['--hud-status-w'])).toBe(STATUS_STRIP.w);
    expect(px(geometry['--hud-status-h'])).toBe(STATUS_STRIP.h);
    expect(px(geometry['--hud-card-x'])).toBe(BOTTOM_CARD.x);
    expect(px(geometry['--hud-card-y'])).toBe(BOTTOM_CARD.y);
    expect(px(geometry['--hud-card-w'])).toBe(BOTTOM_CARD.w);
    expect(px(geometry['--hud-card-h'])).toBe(BOTTOM_CARD.h);
    expect(px(geometry['--hud-card-pad-x'])).toBe(CARD_PAD.x);
    expect(px(geometry['--hud-card-pad-y'])).toBe(CARD_PAD.y);
  });

  it('status strip is x40-600, y0-80, renders icon + word items, and has no rule line', () => {
    const { container } = render(<StatusStrip left="L" items={[{ key: 'a', text: 'Word', icon: 'link' }]} />);
    const el = container.querySelector('[data-hud="status-strip"]')!;
    expect(computed(el, 'left')).toBe('40px');
    expect(computed(el, 'top')).toBe('0px');
    expect(computed(el, 'width')).toBe('560px');
    expect(computed(el, 'height')).toBe('80px');
    expect(computed(el, 'borderBottomStyle')).not.toBe('solid');
    expect(container.querySelector('[data-item="a"] [data-icon="link"]')).not.toBeNull();
    expect(container.querySelector('[data-item="a"]')!.textContent).toBe('Word');
  });

  it('bottom card inner width is 528px (560 minus 16px side padding each side)', () => {
    const { container } = render(
      <CornerBrackets>
        <Body>Inner</Body>
      </CornerBrackets>,
    );
    const card = container.querySelector('[data-hud="card"]')!;
    expect(computed(card, 'left')).toBe('40px');
    expect(computed(card, 'top')).toBe('300px');
    const width = px(computed(card, 'width'));
    const innerWidth = width - px(computed(card, 'paddingLeft')) - px(computed(card, 'paddingRight'));
    expect(width).toBe(BOTTOM_CARD.w);
    expect(innerWidth).toBe(528);
    expect(innerWidth).toBe(CARD_INNER_WIDTH);
    expect(container.querySelectorAll('.hud-bracket')).toHaveLength(4);
  });
});
