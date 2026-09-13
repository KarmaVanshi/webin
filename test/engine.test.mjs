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

test('a glass theme keeps its light body text over a dark ground', () => {
  // A theme whose surface is written down as near-invisible white, which is what an
  // honest liquid-glass file looks like. Judged as written, that panel reads as solid
  // white, no ink reads on both it and the dark canvas, and the guard used to settle on
  // black — a dark theme rendering black text on a dark page. Judged as painted, the
  // panel is dark and white text stands.
  const theme = normaliseTheme({
    name: 'Liquid', dark: true,
    palette: {
      background: '#0A0F1A', surface: 'rgba(255, 255, 255, 0.075)',
      text: 'rgba(255, 255, 255, 0.96)', accent: '#0A84FF',
    },
    shadow: 'glass',
    effects: { blur: 28, surfaceAlpha: 0.075 },
  });
  const css = rootCss(theme, { variables: [] });
  assert.match(css, /body \{[^}]*color: #ffffff/, 'white ink, not black');
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

// ── Roles and materials ─────────────────────────────────────────────────────

const glassy = normaliseTheme({
  name: 'Roled', dark: true,
  palette: { background: '#101A34', surface: '#25324F', text: '#F8FAFC', accent: '#38BDF8' },
  radius: 18, shadow: 'glass',
  effects: { blur: 16, surfaceAlpha: 0.18 },
  materials: {
    soft: { blur: 30, surfaceAlpha: 0.045, radius: 0 },
    strong: { blur: 40, surfaceAlpha: 0.13, radius: 24 },
  },
  roles: { nav: 'soft', modal: 'strong', button: 'soft' },
  states: { lift: 0.05, border: 0.2, scale: 1.02, press: 0.98, ring: 3 },
});

function roleDom() {
  const dom = makeDom(`<html><body style="background-color:#ffffff">
    <header><nav id="nav"><a href="#">Home</a></nav></header>
    <main>
      <article><header id="cardhead">Post</header></article>
      <dialog id="modal">Are you sure?</dialog>
      <button id="btn">Go</button>
      <input id="text" type="text">
      <input id="tick" type="checkbox">
      <input id="send" type="submit" value="Send">
    </main>
  </body></html>`);
  stubLayout(dom, { width: 300, height: 120 });
  return dom;
}

const marksOf = (dom, id) => (dom.window.document.getElementById(id).getAttribute(TOKEN_ATTR) ?? '').split(' ');

test('roles are read from tags and ARIA, not from class names', () => {
  const dom = roleDom();
  new ThemeEngine({ doc: dom.window.document, view: dom.window }).apply(glassy, pageTokens());

  assert.ok(marksOf(dom, 'nav').includes('nv'), 'a <nav> is a nav');
  assert.ok(marksOf(dom, 'modal').includes('ml'), 'a <dialog> is a modal');
  assert.ok(marksOf(dom, 'btn').includes('bt'), 'a <button> is a button');
  assert.ok(marksOf(dom, 'send').includes('bt'), 'so is an <input type=submit>');
});

test('a role the theme does not style is never looked for', () => {
  const dom = roleDom();
  new ThemeEngine({ doc: dom.window.document, view: dom.window }).apply(glassy, pageTokens());

  // `field` is absent from this theme's roles, so no text input carries a field mark
  // however plainly it is one — the walk asks only about what the theme can use.
  assert.ok(!marksOf(dom, 'text').includes('fd'));
  // A tick box is a control the browser draws; a field's padding would deform it.
  assert.ok(!marksOf(dom, 'tick').includes('fd'));
});

test('an article header is that article\'s, not the page\'s', () => {
  const withHeader = normaliseTheme({
    ...JSON.parse(JSON.stringify(glassy)), roles: { header: 'soft' },
  });
  const dom = roleDom();
  new ThemeEngine({ doc: dom.window.document, view: dom.window }).apply(withHeader, pageTokens());

  assert.ok(!marksOf(dom, 'cardhead').includes('hd'),
    'a <header> inside an <article> is scoped to it, and is not the site banner');
});

test('a material is a difference from the theme, not a replacement for it', () => {
  const dom = roleDom();
  const engine = new ThemeEngine({ doc: dom.window.document, view: dom.window });
  engine.apply(glassy, pageTokens());
  const css = engine.css;

  // `soft` names blur, alpha and radius; the glass shadow and edge come from the theme.
  assert.match(css, /\[data-webin~="nv"\] \{[^}]*backdrop-filter: blur\(30px\)/);
  assert.match(css, /\[data-webin~="nv"\] \{[^}]*border-radius: 0px/);
  assert.match(css, /\[data-webin~="nv"\] \{[^}]*box-shadow/, 'inherited from the theme');
  assert.match(css, /\[data-webin~="ml"\] \{[^}]*backdrop-filter: blur\(40px\)/);
});

test('a material never paints over a fill the token pass already chose', () => {
  const dom = roleDom();
  const engine = new ThemeEngine({ doc: dom.window.document, view: dom.window });
  engine.apply(glassy, pageTokens());

  // The accent button is the case this protects: the token pass turns a site's brand fill
  // into the theme accent, and a material that painted over it would hand back a slab.
  assert.match(engine.css, /\[data-webin~="bt"\]:not\(\[data-webin\*="bg"\]\) \{ background-color:/);
});

test('states are composed from amounts, and movement stays off the chrome', () => {
  const dom = roleDom();
  const engine = new ThemeEngine({ doc: dom.window.document, view: dom.window });
  engine.apply(glassy, pageTokens());
  const css = engine.css;

  assert.match(css, /:hover[^{]*\{[^}]*linear-gradient\(rgba\(255, 255, 255, 0\.05\)/);
  assert.match(css, /:focus-visible[^{]*\{[^}]*outline: 3px solid/);

  const transform = css.match(/^(.*)\{ transform: scale\(1\.02\).*$/m)?.[1] ?? '';
  assert.ok(transform.includes('"sf"') || transform.includes('"bt"'), 'cards and buttons move');
  assert.ok(!transform.includes('"nv"'), 'a nav bar does not, or it takes its fixed children with it');
  assert.ok(!transform.includes('"ml"'), 'nor does a modal');
});

test('a theme with no roles emits no role rules at all', () => {
  const dom = roleDom();
  const engine = new ThemeEngine({ doc: dom.window.document, view: dom.window });
  engine.apply(presetById('glass'), pageTokens());

  assert.ok(!engine.css.includes('~="nv"'), 'opt-in, so the 18 shipped presets are untouched');
  assert.ok(!marksOf(dom, 'nav').includes('nv'), 'and nothing is stamped for them either');
});

// ── Everything else the file said ───────────────────────────────────────────
// A theme file describes its buttons, cards, inputs, nav, links, scrollbar and selection in
// CSS-shaped words, and names selectors of its own. All of it renders.

import { readFileSync } from 'node:fs';

const themeFile = (name) => normaliseTheme(JSON.parse(readFileSync(new URL(`../themes/${name}.json`, import.meta.url), 'utf8')));

function fullDom() {
  const dom = makeDom(`<html><body style="background-color:#ffffff">
    <nav id="nav"><a id="link" href="#" aria-current="page">Home</a></nav>
    <main>
      <h2 id="h">Title</h2>
      <div id="card" class="product-tile" style="background-color:#f2f2f2">A card</div>
      <button id="btn">Go</button>
      <input id="text" type="text" placeholder="Search">
      <aside id="side">Side</aside>
    </main>
  </body></html>`);
  stubLayout(dom, { width: 300, height: 120 });
  return dom;
}

test('brutalist02 renders as written: black borders, block shadows, uppercase buttons', () => {
  const theme = themeFile('brutalist02');
  const dom = fullDom();
  const engine = new ThemeEngine({ doc: dom.window.document, view: dom.window });
  engine.apply(theme, pageTokens());
  const css = engine.css;

  assert.ok(marksOf(dom, 'btn').includes('bt'), 'a button rule means buttons are stamped');
  assert.ok(marksOf(dom, 'text').includes('fd'), 'and so are fields');
  assert.match(css, /\[data-webin~="bt"\] \{[^}]*background-color: #000000 !important/);
  assert.match(css, /\[data-webin~="bt"\] \{[^}]*text-transform: uppercase !important/);
  assert.match(css, /\[data-webin~="bt"\] \{[^}]*box-shadow: 5px 5px 0px #FF3B00 !important/);
  assert.match(css, /\[data-webin~="sf"\] \{[^}]*border-width: 3px !important/);
  assert.match(css, /\[data-webin~="sf"\] \{[^}]*box-shadow: 10px 10px 0px #000000 !important/, 'the later `cards` block answers over `surfaces`');
  assert.match(css, /\[data-webin~="nv"\] \{[^}]*border-width: 0px 0px 3px 0px !important/);
  assert.match(css, /body \{[^}]*font-weight: 700 !important/, 'the body block renders too');
  assert.match(css, /::selection \{ background-color: #000000 !important; color: #ffffff !important; \}/);
});

test('ghibli renders its components, its hover, its placeholder, its scrollbar and its gradient', () => {
  const theme = themeFile('ghibli');
  const dom = fullDom();
  const engine = new ThemeEngine({ doc: dom.window.document, view: dom.window });
  engine.apply(theme, pageTokens());
  const css = engine.css;

  assert.match(css, /\[data-webin~="bt"\] \{[^}]*background-color: #6f8f72 !important/);
  assert.match(css, /\[data-webin~="bt"\]:hover \{[^}]*background-color: #607c63 !important/);
  assert.match(css, /\[data-webin~="fd"\]::placeholder \{[^}]*color: #8b917d !important/);
  assert.match(css, /\[data-webin~="fd"\]:focus-visible \{[^}]*border-color: #86a786 !important/);
  assert.match(css, /\[data-webin~="sb"\] \[aria-current\][^{]*\{[^}]*background-color: rgba\(111, 143, 114, 0\.18\)/,
    'the sidebar\'s active item is the current one');
  assert.match(css, /\[data-webin~="sf"\] \{[^}]*backdrop-filter: blur\(14px\) !important/);
  assert.match(css, /::-webkit-scrollbar-thumb \{[^}]*background-color: #a8b99a/);
  assert.match(css, /html \{ background: radial-gradient\(circle at 20% 15%[^;]*linear-gradient\(145deg/,
    'the page gradient is painted as the file wrote it');
  assert.match(css, /transition: all 0\.28s ease !important/);
  assert.ok(!css.includes('url('), 'and nothing in any of it can fetch');
});

test('a rule\'s fill is what the readability guarantee measures against', () => {
  // Black buttons with white text: the token pass would have made this button the accent
  // with dark ink, and a guard that believed it would force the white text to black.
  const theme = themeFile('brutalist02');
  const dom = fullDom();
  new ThemeEngine({ doc: dom.window.document, view: dom.window }).apply(theme, pageTokens());
  const marks = marksOf(dom, 'btn');
  assert.ok(!marks.includes('kd'), 'white on black is readable, so no ink mark');
  assert.ok(!marks.includes('on'), 'and a button the rule paints is no longer "on the accent"');
});

test('a theme may say how to find its targets, and a selector it names is honoured', () => {
  const theme = normaliseTheme({
    name: 'Selectors', palette: { background: '#fff', surface: '#eee', text: '#000', accent: '#00f' },
    cards: { background: '#fafafa', shadow: '0 2px 8px rgba(0,0,0,0.2)' },
    detect: { card: ['.product-tile', '.tile'] },
    selectors: {
      'main h2': { color: '#123456', 'text-transform': 'uppercase' },
      '.product-tile:hover': 'transform: translateY(-2px); outline: 2px solid red;',
    },
    css: '@media (max-width: 600px) { nav { padding: 0 } } .evil { background: url(https://x/y) }',
  });
  assert.equal(theme.detect.surface, '.product-tile, .tile');

  const dom = fullDom();
  const engine = new ThemeEngine({ doc: dom.window.document, view: dom.window });
  engine.apply(theme, pageTokens());
  const css = engine.css;

  assert.ok(marksOf(dom, 'card').includes('sf'), 'found by the theme\'s own selector');
  assert.match(css, /main h2 \{ color: #123456 !important; text-transform: uppercase !important; \}/);
  assert.match(css, /\.product-tile:hover \{ transform: translateY\(-2px\) !important; outline: 2px solid red !important; \}/);
  assert.match(css, /@media \(max-width: 600px\) \{ nav \{ padding: 0 !important; \} \}/);
  assert.ok(!css.includes('url('), 'a url() is refused wherever it is written');
  assert.ok(!css.includes('.evil'), 'and the rule that carried it is gone with it');
  assert.ok(css.lastIndexOf('main h2 {') > css.lastIndexOf('~="kd"'), 'named selectors come last, after the guarantees');
});

test('the theme\'s rules survive a round trip through its own file format', async () => {
  const { themeToFile, encodeShareCode, decodeShareCode } = await import('../src/shared/theme-format.js');
  const theme = themeFile('ghibli');
  const back = normaliseTheme(themeToFile(theme));
  assert.deepEqual(back.rules, theme.rules);
  assert.deepEqual(back.effects.backdrop, theme.effects.backdrop);
  const decoded = await decodeShareCode(await encodeShareCode(theme));
  assert.deepEqual(normaliseTheme(decoded).rules, theme.rules);
});
