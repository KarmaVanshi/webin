import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, stubLayout, stubRects } from './helpers.mjs';

import { buildMapping, buildCss, rootCss, withAlpha, mix, ThemeEngine } from '../src/content/engine.js';
import { detectTokens, Role } from '../src/content/tokens.js';
import { normaliseTheme } from '../src/shared/theme-format.js';
import { presetById } from '../src/themes/library.js';
import { TOKEN_ATTR, OWNED_ATTR } from '../src/shared/types.js';
import { contrastRatio, parseColor } from '../src/shared/color.js';

/** A page that is white, with grey cards, dark text, muted captions and a blue brand. */
function pageTokens(extra = {}) {
  return {
    backgrounds: [
      { value: '#ffffff', weight: 900000, count: 3 },
      { value: '#f2f2f2', weight: 40000, count: 12 },
      { value: '#1a73e8', weight: 900, count: 4 },   // a button
    ],
    colors: [
      { value: '#0f0f0f', weight: 4000, count: 40 },
      { value: '#606060', weight: 1200, count: 20 },
      { value: '#1a73e8', weight: 200, count: 6 },   // a link
    ],
    borders: [{ value: '#e5e5e5', weight: 30, count: 30 }],
    fonts: [{ value: 'Roboto', weight: 4000, count: 40 }],
    sizes: [{ value: 14, weight: 4000, count: 40 }],
    weights: [{ value: 400, weight: 4000, count: 40 }],
    spacing: [{ value: 8, weight: 30, count: 30 }, { value: 16, weight: 20, count: 20 }],
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
    ...extra,
  };
}

const midnight = presetById('midnight');

test('the page structure survives the reskin', () => {
  const mapping = buildMapping(pageTokens(), midnight);

  assert.equal(mapping.backgrounds.get('#ffffff'), midnight.palette.background, 'canvas stays canvas');
  assert.equal(mapping.backgrounds.get('#f2f2f2'), midnight.palette.surface, 'cards stay raised');
  assert.equal(mapping.backgrounds.get('#1a73e8'), midnight.palette.accent, 'a saturated fill is a button');
  assert.equal(mapping.borders.get('#e5e5e5'), midnight.palette.border);
});

test('text is remapped to something that can actually be read', () => {
  const mapping = buildMapping(pageTokens(), midnight);
  const bg = parseColor(midnight.palette.background);
  const surface = parseColor(midnight.palette.surface);

  for (const [from, to] of mapping.texts) {
    const colour = parseColor(to);
    assert.ok(contrastRatio(colour, bg) >= 4.4, `${from} -> ${to} unreadable on the canvas`);
    assert.ok(contrastRatio(colour, surface) >= 4.4, `${from} -> ${to} unreadable on a card`);
  }
});

test('a saturated text colour stays a link, in the theme accent', () => {
  const mapping = buildMapping(pageTokens(), midnight);
  const link = mapping.texts.get('#1a73e8');
  const body = mapping.texts.get('#0f0f0f');
  assert.notEqual(link, body, 'links must not flatten into body text');
});

test('radius scales from the page rhythm and a zero-radius theme flattens everything', () => {
  const rounded = buildMapping(pageTokens(), presetById('blossom'));
  assert.equal(rounded.radii.get(4), 16, 'the dominant radius becomes the theme radius');

  const flat = buildMapping(pageTokens(), presetById('bauhaus'));
  assert.equal(flat.radii.get(4), 0);
});

test('density rescales the page spacing rhythm', () => {
  const loose = buildMapping(pageTokens(), presetById('reading')); // density 1.3
  assert.equal(loose.paddings.get(8), 10);
  assert.equal(loose.paddings.get(16), 21);

  const same = buildMapping(pageTokens(), midnight); // density 1
  assert.equal(same.paddings.size, 0, 'no rules at all when nothing changes');
});

// ─── Custom properties ─────────────────────────────────────────────────────

test('root variables are classified by what the colour does, not what it is called', () => {
  const tokens = pageTokens({
    variables: [
      { name: '--brand', value: '#1a73e8', parsed: parseColor('#1a73e8') },
      { name: '--text', value: '#0f0f0f', parsed: parseColor('#0f0f0f') },
      { name: '--canvas', value: '#ffffff', parsed: parseColor('#ffffff') },
      { name: '--card', value: '#f2f2f2', parsed: parseColor('#f2f2f2') },
      { name: '--scrim', value: 'rgba(0, 0, 0, 0.4)', parsed: parseColor('rgba(0,0,0,0.4)') },
    ],
  });
  const mapping = buildMapping(tokens, midnight);
  const byName = Object.fromEntries(mapping.variables.map((v) => [v.name, v.value]));

  assert.equal(byName['--brand'], midnight.palette.accent);
  assert.equal(byName['--text'], midnight.palette.text.toLowerCase(), 'the darkest ink becomes the theme ink');
  assert.notEqual(byName['--canvas'], undefined);
  assert.ok(byName['--scrim'].startsWith('rgba('), 'a translucent variable stays translucent');
  assert.match(byName['--scrim'], /0\.4\)$/);
});

test('root CSS is complete on its own, so it can be injected before the page paints', () => {
  const tokens = pageTokens({ variables: [{ name: '--bg', value: '#ffffff', parsed: parseColor('#ffffff') }] });
  const css = rootCss(midnight, buildMapping(tokens, midnight));

  assert.match(css, /:root \{ --bg: [^;]+ !important; \}/);
  assert.match(css, /html \{[^}]*background-color: #0B1120 !important/i);
  assert.match(css, /color-scheme: dark/);
  assert.match(css, /body \{[^}]*color: #E8EEF7 !important/i);
});

// ─── Generated CSS ─────────────────────────────────────────────────────────

test('only marks that appear on the page get a rule', () => {
  const mapping = buildMapping(pageTokens(), midnight);
  const index = { bg: new Map([['#ffffff', 0], ['#f2f2f2', 1]]), tx: new Map([['#0f0f0f', 0]]), bd: new Map(), rd: new Map(), pd: new Map(), gp: new Map() };

  const css = buildCss(midnight, mapping, new Set(['bg0', 'tx0']), index);
  assert.match(css, /\[data-webin~="bg0"\]/);
  assert.match(css, /\[data-webin~="tx0"\]/);
  assert.ok(!css.includes('bg1'), 'an unused token costs nothing');
});

test('text on an accent fill is corrected after the text rules, so it wins', () => {
  const mapping = buildMapping(pageTokens(), midnight);
  const index = { bg: new Map(), tx: new Map([['#1a73e8', 0]]), bd: new Map(), rd: new Map(), pd: new Map(), gp: new Map() };
  const css = buildCss(midnight, mapping, new Set(['tx0', 'on']), index);

  assert.ok(css.indexOf('[data-webin~="on"]') > css.indexOf('[data-webin~="tx0"]'),
    'the on-accent rule must come last to beat the link colour');
});

test('surface treatments only reach elements marked as surfaces', () => {
  const bauhaus = presetById('bauhaus');
  const mapping = buildMapping(pageTokens(), bauhaus);
  const empty = { bg: new Map(), tx: new Map(), bd: new Map(), rd: new Map(), pd: new Map(), gp: new Map() };

  const withSurface = buildCss(bauhaus, mapping, new Set(['sf']), empty);
  assert.match(withSurface, /\[data-webin~="sf"\] \{[^}]*box-shadow: 4px 4px 0 0/);
  assert.match(withSurface, /border: 2px solid/);

  const without = buildCss(bauhaus, mapping, new Set(), empty);
  assert.ok(!without.includes('box-shadow'), 'no surfaces, no shadow rule');
});

test('glass themes paint a backdrop and let the canvas through', () => {
  const glass = presetById('glass');
  const mapping = buildMapping(pageTokens(), glass);

  assert.equal(mapping.backgrounds.get('#ffffff'), 'transparent', 'the page canvas gets out of the way');
  const css = buildCss(glass, mapping, new Set(['sf']), { bg: new Map(), tx: new Map(), bd: new Map(), rd: new Map(), pd: new Map(), gp: new Map() });
  assert.match(css, /backdrop-filter: blur\(16px\)/);
  assert.match(css, /html \{ background: radial-gradient/);
});

test('a font stack is applied by inheritance, and icon fonts are left alone', () => {
  const css = buildCss(presetById('terminal'), buildMapping(pageTokens(), presetById('terminal')), new Set(), null);
  assert.match(css, /body \*:not\(code\)/);
  assert.match(css, /:not\(\[class\*="icon"\]\)/);
});

// ─── Stamping ──────────────────────────────────────────────────────────────

function domFixture() {
  const dom = makeDom(`<html><body style="background-color:#ffffff">
    <div id="card" style="background-color:#f2f2f2;color:#0f0f0f">
      <p id="caption" style="color:#606060">caption</p>
      <button id="cta" style="background-color:#1a73e8;color:#ffffff">Buy</button>
    </div>
    <img id="photo" src="x.png" style="background-color:#f2f2f2">
    <div id="ours" ${OWNED_ATTR}="" style="background-color:#f2f2f2"></div>
  </body></html>`);
  stubLayout(dom, { width: 300, height: 120 });
  return dom;
}

test('elements are stamped with the tokens they use', () => {
  const dom = domFixture();
  const engine = new ThemeEngine({ doc: dom.window.document, view: dom.window });
  const result = engine.apply(midnight, pageTokens());

  const card = dom.window.document.getElementById('card');
  assert.match(card.getAttribute(TOKEN_ATTR), /bg\d/);
  assert.match(card.getAttribute(TOKEN_ATTR), /sf/, 'an opaque non-canvas box is a surface');
  assert.ok(result.stamped >= 3);
});

test('media and the extension\'s own nodes are never touched', () => {
  const dom = domFixture();
  const engine = new ThemeEngine({ doc: dom.window.document, view: dom.window });
  engine.apply(midnight, pageTokens());

  assert.equal(dom.window.document.getElementById('photo').hasAttribute(TOKEN_ATTR), false);
  assert.equal(dom.window.document.getElementById('ours').hasAttribute(TOKEN_ATTR), false);
});

test('a label on an accent fill is marked so its colour can be flipped', () => {
  const dom = domFixture();
  const engine = new ThemeEngine({ doc: dom.window.document, view: dom.window });
  engine.apply(midnight, pageTokens());

  const marks = dom.window.document.getElementById('cta').getAttribute(TOKEN_ATTR).split(' ');
  assert.ok(marks.includes('on'), 'the button itself sits on the accent');
});

test('shadow DOM is walked and gets its own copy of the sheet', () => {
  const dom = makeDom('<html><body style="background-color:#ffffff"><div id="host"></div></body></html>');
  stubLayout(dom, { width: 200, height: 80 });
  const doc = dom.window.document;
  const shadow = doc.getElementById('host').attachShadow({ mode: 'open' });
  shadow.innerHTML = '<section id="inner" style="background-color:#f2f2f2;color:#0f0f0f">inside</section>';

  const engine = new ThemeEngine({ doc, view: dom.window });
  const result = engine.apply(midnight, pageTokens());

  assert.match(shadow.getElementById('inner').getAttribute(TOKEN_ATTR), /bg\d/);
  assert.equal(result.roots, 1, 'the shadow root is counted');
  assert.ok(shadow.querySelector('style') || shadow.adoptedStyleSheets?.length,
    'the sheet reaches inside the shadow root');
});

test('content added later is stamped without rewalking the page', () => {
  const dom = domFixture();
  const doc = dom.window.document;
  const engine = new ThemeEngine({ doc, view: dom.window });
  engine.apply(midnight, pageTokens());

  const fresh = doc.createElement('div');
  fresh.style.backgroundColor = '#f2f2f2';
  fresh.style.color = '#606060';
  doc.body.appendChild(fresh);
  assert.equal(fresh.hasAttribute(TOKEN_ATTR), false);

  engine.restampFrom([fresh]);
  assert.match(fresh.getAttribute(TOKEN_ATTR), /bg\d/);
});

test('clearing puts the page back exactly as it was', () => {
  const dom = domFixture();
  const doc = dom.window.document;
  const engine = new ThemeEngine({ doc, view: dom.window });
  engine.apply(midnight, pageTokens());
  engine.clear();

  assert.equal(doc.querySelectorAll(`[${TOKEN_ATTR}]`).length, 0);
  assert.equal(doc.querySelectorAll(`style[${OWNED_ATTR}]`).length, 0);
  assert.equal(engine.active, null);
});

// ─── Idempotence ───────────────────────────────────────────────────────────

test('a second pass over a themed page changes nothing', () => {
  const dom = domFixture();
  const doc = dom.window.document;
  const engine = new ThemeEngine({ doc, view: dom.window });
  engine.apply(presetById('reading'), pageTokens()); // density 1.3, so padding is remapped

  const snapshot = () => [...doc.querySelectorAll(`[${TOKEN_ATTR}]`)]
    .map((el) => `${el.id || el.tagName}:${el.getAttribute(TOKEN_ATTR)}`);
  const first = snapshot();

  engine.restamp();
  engine.restamp();

  assert.deepEqual(snapshot(), first, 'marks must not drift across re-stamps');
});

test('a re-stamp does not mistake a colour the theme produced for a page token', () => {
  // The trap: the page canvas is #ffffff and the theme paints cards #ffffff too. Reading
  // a themed card back must not label it as the canvas.
  const theme = normaliseTheme({
    name: 'White cards',
    palette: { background: '#f0f0f0', surface: '#ffffff', text: '#111111', textMuted: '#555555', accent: '#cc0000' },
  });
  const dom = domFixture();
  const doc = dom.window.document;
  const engine = new ThemeEngine({ doc, view: dom.window });
  engine.apply(theme, pageTokens());

  const card = doc.getElementById('card');
  const before = card.getAttribute(TOKEN_ATTR);
  // The card now computes as #ffffff — the same string as the page's own canvas token.
  card.style.backgroundColor = '#ffffff';
  engine.restamp();

  assert.equal(card.getAttribute(TOKEN_ATTR), before, 'the card keeps its surface mark');
});

test('an incremental pass never strips a stamp it did not place', () => {
  const dom = domFixture();
  const doc = dom.window.document;
  const engine = new ThemeEngine({ doc, view: dom.window });
  engine.apply(midnight, pageTokens());

  const card = doc.getElementById('card');
  assert.ok(card.hasAttribute(TOKEN_ATTR));

  // Something the engine cannot read: a colour that is neither a token nor a theme output.
  card.style.backgroundColor = 'rgb(1, 2, 3)';
  engine.restamp();
  assert.ok(card.hasAttribute(TOKEN_ATTR), 'still stamped');
});

test('a pill or a circle never gets a card treatment', () => {
  const dom = makeDom(`<html><body style="background-color:#ffffff">
    <div id="card" style="background-color:#f2f2f2;border-radius:4px">card</div>
    <span id="chip" style="background-color:#f2f2f2;border-radius:999px">chip</span>
    <div id="avatar" style="background-color:#f2f2f2;border-radius:50%"></div>
  </body></html>`);
  stubLayout(dom, { width: 300, height: 120 });
  stubRects(dom, { '#chip': { width: 90, height: 32 }, '#avatar': { width: 64, height: 64 } });

  const doc = dom.window.document;
  const engine = new ThemeEngine({ doc, view: dom.window });
  engine.apply(presetById('blossom'), pageTokens()); // radius 16, soft shadow

  const marks = (id) => (doc.getElementById(id).getAttribute(TOKEN_ATTR) ?? '').split(' ');
  assert.ok(marks('card').includes('sf'), 'a card is a card');
  assert.ok(!marks('chip').includes('sf'), 'a pill keeps its shape');
  assert.ok(!marks('avatar').includes('sf'), 'an avatar stays round');
});

test('a percentage radius is not a step on the radius scale', () => {
  const dom = makeDom(`<html><body style="background-color:#ffffff">
    <div style="background-color:#f2f2f2;border-radius:50%"></div>
  </body></html>`);
  stubLayout(dom, { width: 64, height: 64 });

  const tokens = detectTokens(dom.window.document, dom.window);
  assert.deepEqual(tokens.radii, [], '50% must not be tallied as 50px');
});

// ─── Detection ─────────────────────────────────────────────────────────────

test('detection reads the page that is rendered, not the CSS that was written', () => {
  const dom = makeDom(`<html><body style="background-color:#ffffff">
    <p style="color:#0f0f0f">Some real body text on the page, long enough to weigh something.</p>
    <p style="color:#606060">A quieter caption.</p>
    <a href="#" style="color:#1a73e8">A link</a>
  </body></html>`);
  stubLayout(dom, { width: 800, height: 600 });

  const tokens = detectTokens(dom.window.document, dom.window);
  assert.equal(tokens.roles[Role.BACKGROUND], '#ffffff');
  assert.equal(tokens.roles[Role.TEXT], '#0f0f0f');
  assert.equal(tokens.roles[Role.ACCENT], '#1a73e8', 'the chromatic colour is the brand');
  assert.equal(tokens.dark, false);
});

// ─── Helpers ───────────────────────────────────────────────────────────────

test('alpha survives a remap and mixing stays inside the range', () => {
  assert.equal(withAlpha('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
  assert.equal(withAlpha('#ff0000', 1), '#ff0000');
  assert.equal(withAlpha('#ff0000', null), '#ff0000');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#000000', '#ffffff', 5), '#ffffff');
});

test('every shipped theme produces CSS without throwing', () => {
  const tokens = pageTokens({
    variables: [{ name: '--x', value: '#f2f2f2', parsed: parseColor('#f2f2f2') }],
  });
  for (const id of ['minimal', 'editorial', 'sage', 'reading', 'blossom', 'contrast', 'flat',
    'skeuomorphic', 'neumorphic', 'glass', 'bauhaus', 'bold-type', 'brutalist', 'neon',
    'midnight', 'terminal', 'nord', 'dracula']) {
    const theme = presetById(id);
    assert.ok(theme, `${id} exists`);
    const mapping = buildMapping(tokens, theme);
    const css = buildCss(theme, mapping, new Set(['sf', 'on']), { bg: new Map(), tx: new Map(), bd: new Map(), rd: new Map(), pd: new Map(), gp: new Map() });
    assert.ok(css.length > 50, `${id} produced CSS`);
    assert.ok(!css.includes('undefined'), `${id} has no undefined values`);
    assert.ok(!css.includes('NaN'), `${id} has no NaN values`);
  }
});

test('a theme from a friend cannot smuggle CSS through the engine', () => {
  const hostile = normaliseTheme({
    name: 'Hostile',
    palette: { background: '#fff', surface: '#eee', text: '#000', textMuted: '#666', accent: '#f00' },
    fontFamily: 'X; } * { background: url(https://evil.example/beacon) } .y {',
    displayFamily: 'Y"; }',
  });
  const css = buildCss(hostile, buildMapping(pageTokens(), hostile), new Set(), null);
  assert.ok(!css.includes('evil.example'), 'the font stack never reaches the stylesheet');
  assert.ok(!css.includes('url('), 'no url() smuggled in');
});
