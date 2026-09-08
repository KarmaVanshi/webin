/**
 * Themes and design token detection (§49, §87, §90).
 *
 * The page below is deliberately ordinary: a white canvas, a subtly tinted section, cards
 * on top, body text, a muted caption, a link and a solid button. Every heuristic in the
 * detector has to get one of those right.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './helpers.mjs';
import { MemoryBackend } from '../src/storage/bridge.js';
import { Msg, TOKEN_ATTR } from '../src/shared/types.js';

const PAGE = `<html><body style="background-color:#ffffff;color:#222222">
  <header style="background-color:#ffffff;color:#222222;border-top:1px solid #e5e7eb">Site</header>
  <main style="background-color:#f9fafb">
    <div style="background-color:#ffffff;border-top:1px solid #e5e7eb;border-top-left-radius:8px;padding:16px;color:#222222">
      <h2 style="color:#222222">Widget</h2>
      <p style="color:#6b7280">A muted caption sitting under the title, longer than the heading.</p>
      <a href="#" style="color:#2563eb">Read more about this widget</a>
      <button style="background-color:#2563eb;color:#ffffff;border-top-left-radius:8px;padding:12px">Buy Now</button>
    </div>
  </main></body></html>`;

/** jsdom reports no geometry; area weighting needs plausible boxes. */
function stubAreas(dom) {
  dom.window.Element.prototype.getBoundingClientRect = function () {
    const tag = this.tagName.toLowerCase();
    const size = tag === 'body' ? { width: 1200, height: 900 }
      : tag === 'main' ? { width: 1200, height: 600 }
      : tag === 'button' ? { width: 120, height: 40 }
      : { width: 400, height: 100 };
    const box = { x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, ...size };
    return { ...box, toJSON: () => box };
  };
  return dom;
}

async function setup(url = 'https://shop.test/products') {
  stubAreas(makeDom(PAGE, { url }));
  return {
    tokens: await import('../src/content/design-system/tokens.js'),
    themes: await import('../src/content/design-system/themes.js'),
  };
}

test('detection finds what the page actually paints, not what it mentions most', async () => {
  const { tokens: T } = await setup();
  const tokens = T.detectTokens(document.body, window);

  assert.equal(tokens.roles.background, '#ffffff', 'the canvas is the colour covering the most area');
  assert.equal(tokens.roles.surface, '#f9fafb', 'the next distinct background is the surface');
  assert.equal(tokens.roles.text, '#222222',
    'body text wins on contrast × usage, not on one long muted paragraph');
  assert.equal(tokens.roles.textMuted, '#6b7280', 'the quieter colour becomes muted text');
  assert.equal(tokens.roles.accent, '#2563eb', 'the saturated colour is the brand accent');
  assert.equal(tokens.roles.border, '#e5e7eb');
  assert.ok(tokens.spacing.some((t) => t.value === 16), 'spacing rhythm detected');
  assert.ok(tokens.scanned >= 7);
});

test('a white button label is not mistaken for page text', async () => {
  const { tokens: T } = await setup();
  const tokens = T.detectTokens(document.body, window);
  assert.notEqual(tokens.roles.text, '#ffffff');
  assert.notEqual(tokens.roles.textMuted, '#ffffff',
    'white on an accent button has no contrast against the canvas, so it is not page text');
});

test('mapping preserves the page structure rather than flattening it', async () => {
  const { tokens: T, themes: TH } = await setup();
  const tokens = T.detectTokens(document.body, window);
  const theme = TH.presetById('terminal');
  const mapping = TH.buildMapping(tokens, theme);

  assert.equal(mapping.backgrounds.get('#ffffff'), theme.palette.background, 'canvas → theme background');
  assert.equal(mapping.backgrounds.get('#f9fafb'), theme.palette.surface, 'surface → theme surface');
  assert.equal(mapping.backgrounds.get('#2563eb'), theme.palette.accent,
    'a saturated background is a button, so it keeps being a button');
  assert.equal(mapping.texts.get('#222222'), theme.palette.text);
  assert.equal(mapping.texts.get('#6b7280'), theme.palette.textMuted);
  assert.equal(mapping.texts.get('#2563eb'), theme.palette.accent, 'links stay links');
  assert.equal(mapping.borders.get('#e5e7eb'), theme.palette.border);
});

test('applying a theme costs rules per token, not per element', async () => {
  const { tokens: T, themes: TH } = await setup();
  const tokens = T.detectTokens(document.body, window);
  const engine = new TH.ThemeEngine({ doc: document, view: window });
  const result = engine.apply(TH.presetById('terminal'), tokens);

  assert.ok(result.rules <= 12, `expected a handful of rules, got ${result.rules}`);
  assert.ok(result.stamped >= 6, 'elements are stamped with the tokens they use');

  const css = engine.toCss();
  assert.ok(css.includes(`[${TOKEN_ATTR}~="bg0"]`), 'rules key off the token attribute');
  assert.match(css, /background-color: #020617 !important/);
  assert.match(css, /html, body \{/, 'the canvas is set page-wide');

  const button = document.querySelector('button');
  assert.match(button.getAttribute(TOKEN_ATTR), /bg\d/, 'the button carries its background token');
});

test('text on an accent surface stays legible', async () => {
  const { tokens: T, themes: TH } = await setup();
  const tokens = T.detectTokens(document.body, window);
  const theme = TH.presetById('terminal');
  const engine = new TH.ThemeEngine({ doc: document, view: window });
  engine.apply(theme, tokens);
  assert.ok(engine.toCss().includes(`color: ${theme.palette.onAccent} !important`),
    'a label on a remapped accent background gets the theme’s on-accent colour');
});

test('clearing a theme leaves no trace on the page', async () => {
  const { tokens: T, themes: TH } = await setup();
  const tokens = T.detectTokens(document.body, window);
  const engine = new TH.ThemeEngine({ doc: document, view: window });
  engine.apply(TH.presetById('sage'), tokens);
  assert.ok(document.querySelectorAll(`[${TOKEN_ATTR}]`).length > 0);

  engine.clear();
  assert.equal(document.querySelectorAll(`[${TOKEN_ATTR}]`).length, 0, 'every stamp removed');
  assert.equal(document.getElementById('widt-theme'), null, 'stylesheet removed');
  assert.equal(engine.active, null);
});

test('every preset is complete and internally legible', async () => {
  const { themes: TH } = await setup();
  const { contrastRatio, parseColor } = await import('../src/shared/color.js');
  assert.ok(TH.PRESETS.length >= 6);
  for (const theme of TH.PRESETS) {
    for (const key of ['background', 'surface', 'text', 'textMuted', 'accent', 'onAccent', 'border']) {
      assert.ok(theme.palette[key], `${theme.id} is missing ${key}`);
      assert.ok(parseColor(theme.palette[key]), `${theme.id}.${key} is not a colour`);
    }
    const bg = parseColor(theme.palette.background);
    assert.ok(contrastRatio(parseColor(theme.palette.text), bg) >= 4.5,
      `${theme.id}: body text must clear 4.5:1`);
    assert.ok(contrastRatio(parseColor(theme.palette.textMuted), bg) >= 4.5,
      `${theme.id}: muted text must clear 4.5:1 too`);
    // 4.5, not 3. A button label and a link are normal-size body text, and the looser bar
    // is what let four presets ship with links that could not be read.
    assert.ok(contrastRatio(parseColor(theme.palette.onAccent), parseColor(theme.palette.accent)) >= 4.5,
      `${theme.id}: a label on the accent fill must clear 4.5:1`);
    const surface = parseColor(theme.palette.surface);
    for (const [where, on] of [['background', bg], ['surface', surface]]) {
      assert.ok(contrastRatio(parseColor(theme.palette.accent), on) >= 4.5,
        `${theme.id}: link text must clear 4.5:1 on the ${where}`);
    }
  }
});

test('the page can be captured as a reusable theme', async () => {
  const { tokens: T, themes: TH } = await setup();
  const tokens = T.detectTokens(document.body, window);
  const captured = TH.themeFromTokens(tokens, 'Shop');

  assert.equal(captured.name, 'Shop');
  assert.ok(captured.custom);
  assert.equal(captured.palette.background, '#ffffff');
  assert.equal(captured.palette.text, '#222222');
  assert.equal(captured.palette.accent, '#2563eb');
  assert.equal(captured.dark, false);

  // And it round-trips: applying it to the page it came from is a near no-op.
  const engine = new TH.ThemeEngine({ doc: document, view: window });
  assert.ok(engine.apply(captured, tokens).rules > 0);
});

test('a theme survives a reload and per-element edits still beat it', async () => {
  const backend = new MemoryBackend();
  await setup();
  const { Editor } = await import('../src/content/main.js');

  const editor = new Editor({ doc: document, view: window, backend });
  await editor.boot();
  await editor.handleMessage({ type: Msg.APPLY_THEME, themeId: 'terminal' });
  await editor.handleMessage({ type: Msg.SAVE });

  let status = await editor.handleMessage({ type: Msg.GET_STATUS });
  assert.equal(status.theme.id, 'terminal');

  // Reload with the same storage.
  stubAreas(makeDom(PAGE, { url: 'https://shop.test/products' }));
  const reloaded = new Editor({ doc: document, view: window, backend });
  await reloaded.boot();
  await new Promise((r) => setTimeout(r, 20));

  const themeSheet = document.getElementById('widt-theme');
  assert.ok(themeSheet, 'the theme comes back on reload');
  assert.match(themeSheet.textContent, /#020617/);

  status = await reloaded.handleMessage({ type: Msg.GET_STATUS });
  assert.equal(status.theme.id, 'terminal');

  // The theme sheet must sit before the override sheet so hand edits win (§33).
  const overrides = document.getElementById('widt-overrides');
  assert.ok(overrides, 'the override sheet exists');
  assert.equal(
    themeSheet.compareDocumentPosition(overrides) & 4 /* DOCUMENT_POSITION_FOLLOWING */, 4,
    'overrides come after the theme, so equal-specificity rules resolve in the user’s favour');
});

test('clearing a theme removes it from storage too', async () => {
  const backend = new MemoryBackend();
  await setup();
  const { Editor } = await import('../src/content/main.js');
  const editor = new Editor({ doc: document, view: window, backend });
  await editor.boot();
  await editor.handleMessage({ type: Msg.APPLY_THEME, themeId: 'sage' });
  await editor.handleMessage({ type: Msg.SAVE });
  await editor.handleMessage({ type: Msg.CLEAR_THEME });

  stubAreas(makeDom(PAGE, { url: 'https://shop.test/products' }));
  const reloaded = new Editor({ doc: document, view: window, backend });
  await reloaded.boot();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(document.getElementById('widt-theme'), null, 'it does not come back');
});

test('a captured theme is stored globally and offered on any site', async () => {
  const backend = new MemoryBackend();
  await setup();
  const { Editor } = await import('../src/content/main.js');
  const editor = new Editor({ doc: document, view: window, backend });
  await editor.boot();
  await editor.handleMessage({ type: Msg.SAVE_THEME });

  const list = await editor.handleMessage({ type: Msg.LIST_THEMES });
  assert.ok(list.themes.some((t) => t.custom), 'the captured theme joins the gallery');
  assert.ok(list.themes.length > 6, 'alongside the presets');
});

/**
 * The two ways theming used to make text unreadable, both on one page: a link sitting
 * directly on an accent fill, and a plain white card nested inside that same fill.
 */
const NESTED = `<html><body style="background-color:#ffffff;color:#222222">
  <main style="background-color:#f9fafb">
    <section id="hero" style="background-color:#2563eb;color:#ffffff;padding:16px">
      <p id="hero-text" style="color:#ffffff">Hero copy on the accent</p>
      <a id="hero-link" href="#" style="color:#93c5fd">Terms apply</a>
      <div id="card" style="background-color:#ffffff;padding:16px;color:#222222">
        <p id="card-text" style="color:#222222">A card sitting on top of the hero.</p>
        <a id="card-link" href="#" style="color:#2563eb">A link inside the card</a>
      </div>
    </section>
  </main></body></html>`;

async function setupNested() {
  stubAreas(makeDom(NESTED, { url: 'https://shop.test/nested' }));
  return {
    tokens: await import('../src/content/design-system/tokens.js'),
    themes: await import('../src/content/design-system/themes.js'),
  };
}

const marks = (id) => (document.getElementById(id).getAttribute(TOKEN_ATTR) ?? '').split(' ');

test('a link on an accent fill is painted with the on-accent colour, not the link colour', async () => {
  const { tokens: T, themes: TH } = await setupNested();
  const theme = TH.presetById('editorial');
  const engine = new TH.ThemeEngine({ doc: document, view: window });
  engine.apply(theme, T.detectTokens(document.body, window));

  assert.ok(marks('hero-link').includes('on'),
    'a link is still text: on an accent fill it takes the on-accent colour like any other label');
  assert.ok(marks('hero-text').includes('on'));
  assert.match(engine.toCss(), new RegExp(`\\[${TOKEN_ATTR}~="on"\\] \\{ color: ${theme.palette.onAccent}`),
    'and the mark resolves to the on-accent colour');
});

test('a card nested in an accent fill keeps its own text colour', async () => {
  const { tokens: T, themes: TH } = await setupNested();
  const engine = new TH.ThemeEngine({ doc: document, view: window });
  engine.apply(TH.presetById('editorial'), T.detectTokens(document.body, window));

  // The old descendant selector painted on-accent through every level, so white-on-accent
  // landed on a white card and the text disappeared.
  assert.doesNotMatch(engine.toCss(), new RegExp(`\\[${TOKEN_ATTR}~="bg\\d+"\\] \\*`),
    'no rule reaches down the whole subtree of an accent fill');
  for (const id of ['card', 'card-text', 'card-link']) {
    assert.ok(!marks(id).includes('on'),
      `${id} sits on its own opaque background, so the fill above it does not decide its colour`);
  }

  // What actually matters: the card's text is readable against the card, not the hero.
  const { contrastRatio, parseColor } = await import('../src/shared/color.js');
  const mapping = TH.buildMapping(T.detectTokens(document.body, window), TH.presetById('editorial'));
  const cardBg = mapping.backgrounds.get('#ffffff');
  for (const from of ['#222222', '#2563eb']) {
    assert.ok(contrastRatio(parseColor(mapping.texts.get(from)), parseColor(cardBg)) >= 4.5,
      `${from} stays legible on the card it sits on`);
  }
});

test('a theme cannot hand a page an unreadable link colour', async () => {
  const { tokens: T, themes: TH } = await setupNested();
  const { contrastRatio, parseColor } = await import('../src/shared/color.js');

  // A custom theme is whatever the user captured or typed, so the guarantee has to live in
  // the engine rather than in the shipped palettes.
  const hostile = {
    id: 'hostile', name: 'Hostile', description: '', dark: false,
    palette: {
      background: '#FFFFFF', surface: '#FFFFFF', text: '#111111', textMuted: '#F0F0F0',
      accent: '#FFE066', onAccent: '#FFF7CC', border: '#EEEEEE',
    },
    radius: null, fontFamily: null, shadow: null, density: null,
  };
  const mapping = TH.buildMapping(T.detectTokens(document.body, window), hostile);
  const white = parseColor('#FFFFFF');

  assert.ok(contrastRatio(parseColor(mapping.texts.get('#2563eb')), white) >= 4.5,
    'the pale accent is darkened until the link can be read');
  assert.ok(contrastRatio(parseColor(mapping.onAccent), parseColor(hostile.palette.accent)) >= 4.5,
    'and the label on the accent fill is fixed the same way');
  for (const [from, to] of mapping.texts) {
    assert.ok(contrastRatio(parseColor(to), white) >= 4.5,
      `every mapped text colour is legible, including ${from} -> ${to}`);
  }
});

/**
 * The whole point, stated as one assertion: pick any preset, apply it to a page, and every
 * piece of text on that page can still be read against whatever it is actually sitting on.
 * Per-token contrast is easy to get right in isolation and still fail here, because what
 * matters is the pairing an element ends up with, not the pairing the palette intended.
 */
test('every preset leaves every element on the page readable', async () => {
  const { contrastRatio, parseColor, normaliseColor } = await import('../src/shared/color.js');
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  // Both fixtures: the ordinary page with a solid button, and the hero with a card and
  // links nested inside an accent fill.
  for (const open of [setup, setupNested]) {
  const { tokens: T, themes: TH } = await open();
  for (const theme of TH.PRESETS) {
    const engine = new TH.ThemeEngine({ doc: document, view: window });
    const tokens = T.detectTokens(document.body, window);
    engine.apply(theme, tokens);
    const mapping = TH.buildMapping(tokens, theme);

    for (const el of document.querySelectorAll('body *')) {
      if (!hasOwnText(el)) continue;

      const stamps = (el.getAttribute(TOKEN_ATTR) ?? '').split(' ');
      const own = normaliseColor(window.getComputedStyle(el).color);
      const color = stamps.includes('on') ? mapping.onAccent : (mapping.texts.get(own) ?? own);

      // The nearest opaque ancestor background is what this text is really sitting on.
      let background = theme.palette.background;
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const raw = window.getComputedStyle(node).backgroundColor;
        const parsed = parseColor(raw);
        if (parsed && parsed.a >= 1) {
          background = mapping.backgrounds.get(normaliseColor(raw)) ?? normaliseColor(raw);
          break;
        }
      }

      const ratio = contrastRatio(parseColor(color), parseColor(background));
      assert.ok(ratio >= 4.5,
        `${theme.id}: <${el.tagName.toLowerCase()}#${el.id}> renders ${color} on ${background} (${ratio.toFixed(2)}:1)`);
    }
    engine.clear();
  }
  }
});
