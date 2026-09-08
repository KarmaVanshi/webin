import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, stubLayout } from './helpers.mjs';

import {
  parseColor, toHex, toCss, contrastRatio, flatten, isTransparent,
  readableOn, ensureReadable, inkFor,
} from '../src/shared/color.js';
import { ThemeEngine, rootCss, buildMapping } from '../src/content/engine.js';
import { Role } from '../src/content/tokens.js';
import { presetById } from '../src/themes/library.js';
import { TOKEN_ATTR, Mark } from '../src/shared/types.js';

const minimal = presetById('minimal');
const ratioOf = (a, b) => contrastRatio(parseColor(a), parseColor(b));

// ─── Colour primitives ─────────────────────────────────────────────────────

test('a theme written in oklch parses like any other', () => {
  // shadcn, DaisyUI v5 and current Tailwind ship their palettes this way. Before this
  // the importer would have rejected every colour in the file.
  assert.equal(toHex(parseColor('oklch(1 0 0)')), '#ffffff');
  assert.equal(toHex(parseColor('oklch(0 0 0)')), '#000000');
  // shadcn's slate-900, whose sRGB form is #0f172a.
  assert.equal(toHex(parseColor('oklch(0.208 0.042 265.755)')), '#0f172b');
  assert.equal(parseColor('oklch(0.6 0.2 20 / 0.5)').a, 0.5);
  // Percentages mean different things per axis: 100% is 1 for lightness, 0.4 for chroma.
  assert.equal(toHex(parseColor('oklch(100% 0 0)')), '#ffffff');
  assert.equal(toHex(parseColor('oklab(0.5 0 0)')), '#636363');
  assert.equal(parseColor('oklch(nonsense)'), null);
});

test('a translucent colour is judged on what it composites to, not what it says', () => {
  // contrastRatio reads luminance and has nowhere to put an alpha channel. Faint white
  // text on a dark panel is the case where that matters: scored raw it looks like one of
  // the best contrasts on the page, and painted it is barely there.
  const ink = 'rgba(255, 255, 255, 0.25)';
  const backdrop = '#222222';
  assert.ok(ratioOf(ink, backdrop) > 15, 'scored raw it passes comfortably');

  const painted = flatten(ink, backdrop);
  assert.equal(toHex(painted), '#595959');
  assert.ok(contrastRatio(painted, parseColor(backdrop)) < 4.5, 'composited it fails');
  assert.equal(toHex(flatten('rgba(255,255,255,0.5)', '#000000')), '#808080');
});

test('a fully transparent background paints nothing and defers to what is behind it', () => {
  assert.equal(isTransparent('rgba(0,0,0,0)'), true);
  assert.equal(isTransparent('transparent'), true);
  assert.equal(isTransparent('#000000'), false);
});

test('ensureReadable always returns an opaque colour', () => {
  // readableOn keeps the alpha it was given, so its answer for a see-through grey is a
  // see-through near-black — which composites back to something unreadable.
  const shaded = readableOn('rgba(128, 128, 128, 0.35)', ['#ffffff']);
  assert.ok(parseColor(shaded).a < 1, 'readableOn preserves alpha, by design');

  const guaranteed = ensureReadable('rgba(128, 128, 128, 0.35)', ['#ffffff']);
  assert.equal(parseColor(guaranteed).a, 1, 'the guarantee does not');
  assert.ok(ratioOf(guaranteed, '#ffffff') >= 4.5);
});

test('when no shade of the hue can be read, the colour is dropped for plain ink', () => {
  // Nothing clears 7:1 against a mid grey; black gets closest at about 5.9.
  const picked = ensureReadable('#2266cc', ['#888888'], 7);
  assert.equal(picked, '#000000');
  assert.ok(ratioOf(picked, '#888888') > ratioOf('#ffffff', '#888888'));
});

test('a colour that is already legible is left exactly as it was', () => {
  assert.equal(ensureReadable('#000000', ['#ffffff']), '#000000');
  assert.equal(ensureReadable('#1a1a1a', ['#ffffff']), '#1a1a1a');
});

test('ink is chosen by which of black or white actually wins', () => {
  assert.equal(inkFor('#ffffff'), 'dark');
  assert.equal(inkFor('#000000'), 'light');
  assert.equal(inkFor('#111111'), 'light');
  assert.equal(inkFor('#f5f5f5'), 'dark');
});

// ─── The guarantee, on a real page ─────────────────────────────────────────

/** A white page with grey cards and dark text — the shape most sites have. */
function pageTokens() {
  return {
    backgrounds: [
      { value: '#ffffff', weight: 900000, count: 3 },
      { value: '#f2f2f2', weight: 40000, count: 12 },
    ],
    colors: [
      { value: '#0f0f0f', weight: 4000, count: 40 },
      { value: '#606060', weight: 1200, count: 20 },
    ],
    borders: [{ value: '#e5e5e5', weight: 30, count: 30 }],
    fonts: [{ value: 'Roboto', weight: 4000, count: 40 }],
    sizes: [{ value: 14, weight: 4000, count: 40 }],
    weights: [{ value: 400, weight: 4000, count: 40 }],
    spacing: [{ value: 8, weight: 30, count: 30 }],
    radii: [{ value: 4, weight: 20, count: 20 }],
    shadows: [],
    variables: [],
    scanned: 500,
    roles: {
      [Role.BACKGROUND]: '#ffffff',
      [Role.SURFACE]: '#f2f2f2',
      [Role.TEXT]: '#0f0f0f',
      [Role.TEXT_MUTED]: '#606060',
      [Role.ACCENT]: '#1a73e8',
      [Role.BORDER]: '#e5e5e5',
    },
    dark: false,
  };
}

/**
 * The failure this whole feature exists for: a panel painted a colour the detector never
 * tallied, so the theme leaves the background alone — and then remaps the text on top of
 * it to the theme's dark ink. Dark on dark. The page had 30 background colours and only
 * the top handful are ever tokens, so this is the ordinary case, not a contrived one.
 */
const PAGE = `<html><body style="background:#ffffff;color:#0f0f0f">
  <p id="fine" style="color:#0f0f0f">Text on the canvas, already readable.</p>
  <div id="panel" style="background:#111111">
    <p id="sunk" style="color:#0f0f0f">Dark text the theme is about to leave on a dark panel.</p>
  </div>
</body></html>`;

function applyTo(html, options) {
  const dom = makeDom(html);
  stubLayout(dom, { width: 600, height: 120 });
  const engine = new ThemeEngine({ doc: dom.window.document, view: dom.window });
  engine.apply(minimal, pageTokens(), options);
  return { dom, engine, doc: dom.window.document };
}

test('text the theme would have left unreadable is forced to ink that can be read', () => {
  const { doc, engine } = applyTo(PAGE);

  const sunk = doc.querySelector('#sunk').getAttribute(TOKEN_ATTR).split(' ');
  assert.ok(sunk.includes(Mark.INK_LIGHT), `expected white ink, got "${sunk.join(' ')}"`);
  assert.ok(!sunk.includes(Mark.INK_DARK));

  // And the rule that mark refers to is actually in the sheet.
  assert.match(engine.css, /\[data-webin~="kl"\] \{ color: #fff !important; \}/);
});

test('text that was already readable is left alone', () => {
  const { doc } = applyTo(PAGE);
  const marks = doc.querySelector('#fine').getAttribute(TOKEN_ATTR)?.split(' ') ?? [];
  assert.ok(!marks.includes(Mark.INK_LIGHT) && !marks.includes(Mark.INK_DARK),
    'the guarantee is a rescue, not a repaint');
});

test('only the element holding the words is marked, not its wrapper', () => {
  // #panel paints the dark background but its own text is in a child. Marking the wrapper
  // would flip colour for anything inside it that had no contrast problem at all.
  const { doc } = applyTo(PAGE);
  const panel = doc.querySelector('#panel').getAttribute(TOKEN_ATTR)?.split(' ') ?? [];
  assert.ok(!panel.includes(Mark.INK_LIGHT) && !panel.includes(Mark.INK_DARK));
});

test('the guarantee can be switched off', () => {
  const { doc, engine } = applyTo(PAGE, { forceReadable: false });
  const marks = doc.querySelector('#sunk').getAttribute(TOKEN_ATTR)?.split(' ') ?? [];
  assert.ok(!marks.includes(Mark.INK_LIGHT), 'no mark when the user has turned it off');
  assert.ok(!engine.css.includes('"kl"'), 'and no rule either');
});

test('the ink rules come after the text rules, so they win on order', () => {
  const { engine } = applyTo(PAGE);
  const css = engine.css;
  const lastText = css.lastIndexOf('[data-webin~="tx');
  const ink = css.indexOf('[data-webin~="kl"]');
  assert.ok(lastText !== -1 && ink !== -1);
  assert.ok(ink > lastText,
    'equal specificity means source order decides; the guarantee has to be last');
});

test('the body colour is guarded, not the raw palette value', () => {
  // Everything without a text stamp of its own inherits from body, so an unchecked
  // value here is a hole straight through the guarantee.
  const harsh = {
    ...minimal,
    palette: { ...minimal.palette, text: '#f0f0f0', background: '#ffffff', surface: '#ffffff' },
  };
  const css = rootCss(harsh, buildMapping(pageTokens(), harsh));
  const declared = css.match(/body \{[^}]*color: ([^;]+) !important;/)[1];
  assert.notEqual(declared, '#f0f0f0', 'the near-white text colour must not survive as-is');
  assert.ok(ratioOf(declared, '#ffffff') >= 4.5, `"${declared}" is unreadable on white`);
});

test('every preset keeps its body text readable on its own canvas', () => {
  for (const id of ['minimal', 'editorial', 'midnight', 'terminal', 'nord', 'dracula', 'glass', 'neon']) {
    const theme = presetById(id);
    const css = rootCss(theme, buildMapping(pageTokens(), theme));
    const declared = css.match(/body \{[^}]*color: ([^;]+) !important;/)[1];
    const worst = Math.min(ratioOf(declared, theme.palette.background), ratioOf(declared, theme.palette.surface));
    assert.ok(worst >= 4.5, `${id}: body text "${declared}" scores ${worst.toFixed(2)}`);
  }
});
