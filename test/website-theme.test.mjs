import test from 'node:test';
import assert from 'node:assert/strict';

import {
  looksLikeHtml, readHtml, stylesheetLinks, splitByColourScheme, themeFromWebsite,
} from '../src/shared/website-theme.js';
import { parseThemeInput } from '../src/shared/theme-format.js';
import { sniffFormat } from '../src/shared/foreign-themes.js';
import { parseColor, contrastRatio } from '../src/shared/color.js';

/** What the importer actually produces: adapted, then validated, exactly as the app does. */
function importAll(text, options = {}) {
  return parseThemeInput(text, null, { name: 'Test', ...options });
}

// ─── Telling a web page from a theme file ───────────────────────────────────

test('a web page is recognised as a page, not as a stylesheet', () => {
  const page = '<!doctype html><html><head><style>body{color:#111}</style></head><body>hi</body></html>';
  assert.equal(looksLikeHtml(page), true);
  assert.equal(sniffFormat(page), 'html');

  // The distinction matters: a page carrying one stray custom property must not be read
  // as a theme file, or its markup gets parsed as declarations.
  const withVar = '<!doctype html><html><head><style>:root{--tab-size:4}</style></head></html>';
  assert.equal(sniffFormat(withVar), 'html');
});

test('a stylesheet with no custom properties at all is still a design', () => {
  const css = 'body { background: #ffffff; color: #222222 } a { color: #0066cc }';
  assert.equal(looksLikeHtml(css), false);
  assert.equal(sniffFormat(css), 'stylesheet');

  const { themes, error } = importAll(css);
  assert.equal(error, null);
  assert.equal(themes[0].palette.background, '#ffffff');
  assert.equal(themes[0].palette.text, '#222222');
  assert.equal(themes[0].palette.accent, '#0066cc');
});

// ─── Finding a page's stylesheets ───────────────────────────────────────────

test('linked stylesheets are found and resolved against the page', () => {
  const html = `
    <link rel="stylesheet" href="/assets/main.css">
    <link rel="stylesheet" href="https://cdn.example.com/lib.css">
    <link rel="preload" href="/assets/not-a-sheet.css">
    <link rel="stylesheet" media="print" href="/assets/paper.css">
    <link rel="stylesheet" data-href="/assets/dark.css">
  `;
  const links = stylesheetLinks(html, 'https://site.example/page/');

  assert.deepEqual(links, [
    'https://site.example/assets/main.css',
    'https://cdn.example.com/lib.css',
    // `data-href` is how a site parks a theme it is not currently wearing.
    'https://site.example/assets/dark.css',
  ], 'preload is not a stylesheet and a print sheet is not the page');
});

test('the same stylesheet linked twice is fetched once', () => {
  const html = '<link rel=stylesheet href="/a.css"><link rel=stylesheet href="/a.css">';
  assert.equal(stylesheetLinks(html, 'https://site.example/').length, 1);
});

// ─── Reading the page itself ────────────────────────────────────────────────

test('a page yields its inline CSS, its theme-color and its links', () => {
  const html = `<!doctype html><html><head>
    <title>Acme</title>
    <meta name="theme-color" content="#e50914">
    <link rel="stylesheet" href="/a.css">
    <style>body{background:#101010;color:#f0f0f0}</style>
  </head><body></body></html>`;

  const page = readHtml(html, 'https://acme.test/');
  assert.match(page.css, /background:#101010/);
  assert.equal(page.themeColor, '#e50914');
  assert.equal(page.title, 'Acme');
  assert.deepEqual(page.links, ['https://acme.test/a.css']);
});

test('a page script is never read as a stylesheet', () => {
  // Inline JSON routinely contains CSS text and style fragments. Importing a colour out
  // of a data blob that never gets painted is importing something the page does not show.
  const html = `<!doctype html><html><head>
    <style>body{background:#ffffff;color:#111111}</style>
    <script type="application/json">{"css":"body{background:#ff0000}","style":"--x: #00ff00"}</script>
  </head></html>`;

  const { themes } = importAll(html);
  assert.equal(themes[0].palette.background, '#ffffff');
});

test('the pre-CSS web still has a design', () => {
  // Hacker News puts its orange in `bgcolor` and nowhere else. A reader that only knows
  // stylesheets decides one of the best-known sites on the internet has no colours.
  const html = `<!doctype html><html><body text="#000000">
    <table bgcolor="#ff6600"><tr><td>header</td></tr></table>
    <style>body{background-color:#f6f6ef}</style>
  </body></html>`;

  const { themes } = importAll(html);
  assert.equal(themes[0].palette.background, '#f6f6ef');
  assert.equal(themes[0].palette.text, '#000000', 'the body text attribute is a declaration');
  assert.equal(themes[0].palette.accent, '#ff6600');
});

test('a body link attribute is a link colour like any other', () => {
  const html = `<!doctype html><html><body bgcolor="#ffffff" text="#111111" link="#0000ee">
    <p>an old page</p>
  </body></html>`;

  const { themes } = importAll(html);
  assert.equal(themes[0].palette.accent, '#0000ee');
});

// ─── Authority beats counting ───────────────────────────────────────────────

test('what body says it is beats what appears most often', () => {
  const css = `
    body { background-color: #ffffff; color: #1a1a1a }
    .card { background-color: #f3f4f6 }
    .a { background-color: #f3f4f6 } .b { background-color: #f3f4f6 }
    .c { background-color: #f3f4f6 } .d { background-color: #f3f4f6 }
  `;
  const { themes } = importAll(css);
  assert.equal(themes[0].palette.background, '#ffffff', 'the page is white however many cards are grey');
  assert.equal(themes[0].palette.surface, '#f3f4f6', 'and the cards are the surface');
});

test('a vivid brand colour is not mistaken for the page', () => {
  // With no page-level rule, counting alone will happily nominate whatever is everywhere.
  // A page is a surface things sit on, and surfaces are not usually pillar-box red.
  const css = `
    .banner { background-color: #d93900 } .hero { background-color: #d93900 }
    .promo { background-color: #d93900 } .strip { background-color: #d93900 }
    .shell { background-color: #fbfbfb } .body-copy { color: #202020 }
  `;
  const { themes } = importAll(css);
  assert.equal(themes[0].palette.background, '#fbfbfb');
});

test('a link colour is not read as body text', () => {
  // Wikipedia's red for broken links contrasts beautifully against its white page and is
  // emphatically not its prose.
  const css = `
    .page { background-color: #fdfdfd }
    .new { color: #bf3c2c } .new-too { color: #bf3c2c }
  `;
  const { themes } = importAll(css);
  const text = parseColor(themes[0].palette.text);
  assert.ok(contrastRatio(text, parseColor('#fdfdfd')) > 4.5, 'still readable');
  assert.notEqual(themes[0].palette.text, '#bf3c2c', 'but not the red');
});

// ─── Colour handling ────────────────────────────────────────────────────────

test('a translucent background is flattened before it becomes a theme', () => {
  // Netflix paints its header `rgba(22, 22, 22, 0.7)`. A theme background is the bottom
  // of the stack with nothing behind it, so a translucent one was never chosen.
  const css = 'body { background-color: rgba(22, 22, 22, 0.7); color: #ffffff }';
  const { themes } = importAll(css);
  assert.doesNotMatch(themes[0].palette.background, /rgba/, 'opaque or it is not a background');
  assert.match(themes[0].palette.background, /^#/);
});

test('a brand colour that only ever appears in a gradient is still the brand colour', () => {
  // Stripe's indigo lives inside a `linear-gradient` and nowhere else in its stylesheet.
  const css = `
    body { background: #ffffff; color: #061b31 }
    a { color: #061b31 }
    .hero { --brand-sweep: linear-gradient(90deg, #ffd601 0%, #533afd 100%) }
  `;
  const { themes } = importAll(css);
  assert.equal(themes[0].palette.accent, '#533afd', 'not the navy the links share with the prose');
});

test('a link painted in the body text colour is not taken for an accent', () => {
  // Plenty of sites style their navigation in the same ink as their prose. The link
  // colour is normally the best evidence there is, so it has to be checked against the
  // text before it is believed, or the brand colour a page does have is never looked for.
  const css = `
    body { background: #ffffff; color: #061b31 }
    a { color: #061b31 }
    .btn { background-color: #533afd }
  `;
  const { themes } = importAll(css);
  assert.equal(themes[0].palette.accent, '#533afd');
});

test('when a page truly has one colour, the accent says so rather than inventing one', () => {
  const css = 'body { background: #ffffff; color: #061b31 } a { color: #061b31 }';
  const { themes, inferred } = importAll(css);
  assert.equal(themes[0].palette.accent, '#061b31');
  assert.ok(inferred.some((note) => /accent ← text/.test(note)), 'and reports that it did');
});

test('the theme-color a page declares outright is believed', () => {
  const css = 'body { background: #ffffff; color: #111111 }';
  const { themes } = importAll(css, { themeColor: '#052962' });
  assert.equal(themes[0].palette.accent, '#052962');
});

// ─── Light and dark ─────────────────────────────────────────────────────────

test('a site that ships both schemes imports as both themes', () => {
  const css = `
    body { background: #ffffff; color: #111111 }
    a { color: #0066cc }
    @media (prefers-color-scheme: dark) {
      body { background: #0b0b0d; color: #f2f2f2 }
      a { color: #7cc4ff }
    }
  `;
  const { themes } = importAll(css);
  assert.equal(themes.length, 2);

  const [light, dark] = themes;
  assert.equal(light.palette.background, '#ffffff');
  assert.equal(light.dark, false);
  assert.equal(dark.palette.background, '#0b0b0d');
  assert.equal(dark.dark, true);
  assert.match(dark.name, /Dark$/);
});

test('class-based dark mode is the same convention by another name', () => {
  const css = `
    body { background: #ffffff; color: #111111 }
    .dark body { background: #101010; color: #eeeeee }
  `;
  const { light, dark } = splitByColourScheme(css);
  assert.equal(light.length, 1);
  assert.equal(dark.length, 1);
  assert.match(dark[0].selector, /\.dark/);
});

test('a dark half that reads the same as the light half is not a second theme', () => {
  const css = `
    body { background: #ffffff; color: #111111 }
    .dark { background: #ffffff; color: #111111 }
  `;
  const result = themeFromWebsite(css, { name: 'Same' });
  assert.equal(result.themes.length, 1);
});

// ─── Being permissive about what a page is ──────────────────────────────────

test('one declaration is enough to make a theme', () => {
  // example.com says only that its page is grey. That is the most important thing about
  // how it looks, and the rest derives from it as it would for any theme file.
  const html = '<!doctype html><html><head><style>body{background:#eeeeee}</style></head></html>';
  const { themes, error } = importAll(html);
  assert.equal(error, null);
  assert.equal(themes[0].palette.background, '#eeeeee');
  assert.ok(contrastRatio(parseColor(themes[0].palette.text), parseColor('#eeeeee')) >= 4.5);
});

test('a page with no styling at all is reported as such rather than invented', () => {
  const html = '<!doctype html><html><body><h1>Hello</h1></body></html>';
  const { themes, error } = importAll(html);
  assert.equal(themes.length, 0);
  assert.ok(error, 'no colours means no theme, not a made-up one');
});

// ─── The shape that comes out ───────────────────────────────────────────────

test('a website candidate carries the page corner and font as well as its colours', () => {
  const css = `
    body { background: #ffffff; color: #111111; font-family: Inter, sans-serif }
    .card { border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,.1) }
    .chip { border-radius: 8px }
    .pill { border-radius: 999px }
  `;
  const { themes } = importAll(css);
  assert.equal(themes[0].radius, 8, 'the pill is a shape, not the corner of the site');
  assert.match(themes[0].fontFamily, /Inter/);
  assert.equal(themes[0].shadow, 'soft');
});

test('every role comes out filled, whatever the page left unsaid', () => {
  const css = 'body { background: #ffffff; color: #111111 }';
  const { themes } = importAll(css);
  for (const role of ['background', 'surface', 'text', 'textMuted', 'accent', 'onAccent', 'border']) {
    assert.match(themes[0].palette[role], /^#|^rgba/, `${role} is filled`);
  }
});
