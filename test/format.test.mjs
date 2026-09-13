import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseTheme, themeToFile, collectionToFile, parseThemeInput,
  encodeShareCode, decodeShareCode, isShareCode, themeFileName, backdropCss,
} from '../src/shared/theme-format.js';
import { parseColor, luminance, rgbToHsl } from '../src/shared/color.js';

const MINIMAL = {
  name: 'Test',
  palette: { background: '#ffffff', surface: '#eeeeee', text: '#111111', textMuted: '#666666', accent: '#ff0000' },
};

test('a theme needs a background and a text colour, and nothing else', () => {
  // What the error message has always promised. Everything past those two can be worked
  // out from them, so refusing a whole palette over any other role was refusing themes
  // people plainly meant to use.
  assert.equal(normaliseTheme(null), null);
  assert.equal(normaliseTheme({ name: 'No palette' }), null);
  assert.equal(normaliseTheme({ palette: { text: '#000' } }), null, 'no page to put the text on');
  assert.equal(normaliseTheme({ palette: { background: '#fff' } }), null, 'nothing to write with');
  assert.ok(normaliseTheme(MINIMAL));

  // A background that does not parse is not a theme without a page: the surface is the
  // same plane, one step in.
  const typo = normaliseTheme({ palette: { background: 'not-a-colour', surface: '#fff', text: '#000' } });
  assert.equal(typo.palette.background, '#ffffff');
});

test('a role the file names by another word is read, not derived', () => {
  // A glass theme calls its raised plane `glass`; a flat one calls it `card`. Neither is
  // a theme with no surface, and taking the colour they gave beats approximating it.
  const glass = normaliseTheme({
    palette: {
      background: '#000000', text: '#ffffff',
      glass: 'rgba(255,255,255,0.075)', textSecondary: '#bbbbbb', primary: '#0a84ff',
    },
  });
  assert.equal(glass.palette.surface, 'rgba(255, 255, 255, 0.075)');
  assert.equal(glass.palette.textMuted, '#bbbbbb');
  assert.equal(glass.palette.accent, '#0a84ff');
});

test('missing roles are filled in rather than rejected', () => {
  const theme = normaliseTheme(MINIMAL);
  // Whichever of black or white actually reads on the accent, rather than always white —
  // the same rule every other format's import has used.
  assert.equal(theme.palette.onAccent, '#000000');
  assert.equal(theme.palette.border, '#d4d4d4', 'a faint line between text and background');
});

test('colours are normalised to one form', () => {
  const theme = normaliseTheme({
    ...MINIMAL,
    palette: { ...MINIMAL.palette, accent: 'rgb(255 0 0)', surface: 'rgba(0,0,0,0.5)' },
  });
  assert.equal(theme.palette.accent, '#ff0000');
  assert.equal(theme.palette.surface, 'rgba(0, 0, 0, 0.5)');
});

test('a font stack that could close a CSS declaration is rejected', () => {
  const hostile = normaliseTheme({ ...MINIMAL, fontFamily: 'Georgia; } html { display: none } .x {' });
  assert.equal(hostile.fontFamily, null, 'injection attempt must not survive');

  const real = normaliseTheme({ ...MINIMAL, fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' });
  assert.equal(real.fontFamily, '"Helvetica Neue", Helvetica, Arial, sans-serif');
});

test('a backdrop is never raw CSS, whoever wrote the theme', () => {
  // The old rule honoured a raw string from a shipped preset. Nothing does now, because
  // there is no longer a raw string to honour: a backdrop is data, and the engine writes
  // the CSS. What used to need trusting is unreachable instead.
  for (const trusted of [false, true]) {
    const hostile = normaliseTheme({ ...MINIMAL, effects: { backdrop: 'url(https://evil.example/x)' } }, { trusted });
    assert.equal(hostile.effects.backdrop, null, 'a string is not a backdrop');

    const escape = normaliseTheme({ ...MINIMAL, effects: { backdrop: { base: '#000; } html { display: none } x {' } } }, { trusted });
    assert.equal(escape.effects.backdrop, null, 'a base that is not a colour is not a base');
  }
});

test('a backdrop is honoured from anybody, and rendered from its parts', () => {
  const theme = normaliseTheme({
    ...MINIMAL,
    effects: { backdrop: { base: '#101a34', blobs: [{ color: '#4338ca', x: 15, y: 10, size: 60 }] } },
  });
  assert.deepEqual(theme.effects.backdrop, {
    base: '#101a34',
    blobs: [{ color: '#4338ca', x: 15, y: 10, size: 60 }],
  });

  const css = backdropCss(theme.effects.backdrop);
  assert.equal(css, 'radial-gradient(60% 60% at 15% 10%, #4338ca 0%, rgba(67, 56, 202, 0) 60%), #101a34');
  // Faded to the blob's own colour at zero alpha, never to the keyword, which would be
  // transparent black and would ring the blob in grey.
  assert.ok(!css.includes('transparent'));
});

test('a backdrop clamps its blobs and drops the ones that are not colours', () => {
  const theme = normaliseTheme({
    ...MINIMAL,
    effects: {
      backdrop: {
        base: '#101a34',
        blobs: [
          { color: '#ff0000', x: -500, y: 900, size: 10000 },
          { color: 'not-a-colour', x: 10, y: 10 },
          { color: '#00ff00' },
          { color: '#0000ff' }, { color: '#ffff00' }, { color: '#00ffff' },
        ],
      },
    },
  });
  const blobs = theme.effects.backdrop.blobs;
  assert.deepEqual(blobs[0], { color: '#ff0000', x: 0, y: 100, size: 200 }, 'clamped to the allowed range');
  assert.deepEqual(blobs[1], { color: '#00ff00', x: 50, y: 50, size: 60 }, 'the unparseable one is gone, the rest keep going');
  assert.ok(blobs.length <= 4, 'a backdrop cannot carry an unbounded number of layers');
});

test('a see-through colour cannot be the page canvas', () => {
  // A transparent canvas paints nothing: the site's own background survives, and the
  // readability guard then picks ink to read against a colour with no substance.
  assert.equal(normaliseTheme({ palette: { background: 'transparent', text: '#fff' } }), null);
  assert.equal(normaliseTheme({ palette: { background: 'rgba(255,255,255,0.075)', text: '#fff' } }), null);

  // A surface may be as see-through as it likes — that is what a glass theme is.
  const glass = normaliseTheme({
    palette: { background: '#101a34', surface: 'rgba(255,255,255,0.075)', text: '#fff' },
  });
  assert.equal(glass.palette.surface, 'rgba(255, 255, 255, 0.075)');
});

test('a theme whose ground is a backdrop is read as having named its canvas', () => {
  // `transparent` plus a backdrop is how a glass theme says "the gradient is the ground".
  const theme = normaliseTheme({
    palette: { background: 'transparent', text: '#ffffff' },
    effects: { backdrop: { base: '#101a34', blobs: [{ color: '#4338ca' }] } },
  });
  assert.ok(theme, 'the base is a real colour and a real ground');
  assert.equal(theme.palette.background, '#101a34');
});

test('a palette written as `colors`, or written flat, is still a palette', () => {
  // Our own spelling is `palette`; almost everything else in the world writes `colors`,
  // and plenty of hand-written files put the two irreplaceable roles on the theme itself.
  const colors = normaliseTheme({
    name: 'Anime Dream',
    colors: { background: '#FFF7FC', surface: '#FFFFFF', text: '#241B2F', primary: '#FF6FAE' },
  });
  assert.equal(colors.palette.background, '#fff7fc');
  assert.equal(colors.palette.accent, '#ff6fae', 'aliases still apply inside the other block');

  const flat = normaliseTheme({ name: 'Flat', background: '#ffffff', text: '#111111' });
  assert.equal(flat.palette.background, '#ffffff');
  assert.equal(flat.palette.text, '#111111');

  // A key that holds something other than a colour is passed over, not tripped on.
  const busy = normaliseTheme({
    name: 'Busy', background: '#ffffff', text: '#111111',
    surface: { background: 'rgba(255,255,255,0.72)', radius: 20 },
  });
  assert.ok(busy, 'a `surface` block is not a surface colour, and is no reason to refuse');
});

test('the block that calls itself a palette wins over one that does not', () => {
  const theme = normaliseTheme({
    palette: { background: '#000000', text: '#ffffff' },
    colors: { background: '#ff0000', text: '#00ff00' },
  });
  assert.equal(theme.palette.background, '#000000');
  assert.equal(theme.palette.text, '#ffffff');
});

test('numbers are clamped and rubbish falls back', () => {
  const theme = normaliseTheme({ ...MINIMAL, radius: 5000, density: 'lots', shadow: 'made-up', effects: { blur: -20, weight: 4000 } });
  assert.equal(theme.radius, 60);
  assert.equal(theme.density, 1);
  assert.equal(theme.shadow, 'soft');
  assert.equal(theme.effects.blur, 0);
  assert.equal(theme.effects.weight, 900);
});

test('unknown fields are dropped', () => {
  const theme = normaliseTheme({ ...MINIMAL, evil: 'payload', effects: { evil: true } });
  assert.equal(theme.evil, undefined);
  assert.equal(theme.effects.evil, undefined);
});

test('control characters are stripped from names', () => {
  const theme = normaliseTheme({ ...MINIMAL, name: 'Bad\u0000\u001Fname' });
  assert.equal(theme.name, 'Badname');
});

test('a share code round-trips through compression', async () => {
  const theme = normaliseTheme({ ...MINIMAL, name: 'Round trip', radius: 12, shadow: 'hard' });
  const code = await encodeShareCode(theme);

  assert.ok(isShareCode(code));
  assert.ok(!/\s/.test(code), 'a code must survive being pasted into a chat window');

  const decoded = await decodeShareCode(code);
  const back = parseThemeInput(code, decoded).themes[0];
  assert.equal(back.name, 'Round trip');
  assert.equal(back.radius, 12);
  assert.equal(back.shadow, 'hard');
  assert.deepEqual(back.palette, theme.palette);
});

test('a damaged share code decodes to nothing rather than throwing', async () => {
  assert.equal(await decodeShareCode('webin:1z:!!!!not-base64!!!!'), null);
  assert.equal(await decodeShareCode('webin:1:aGVsbG8'), null, 'valid base64 that is not JSON');
  assert.equal(await decodeShareCode('just some text'), null);
});

test('a plain theme file imports, and so does a collection', () => {
  const theme = normaliseTheme(MINIMAL);
  const single = parseThemeInput(JSON.stringify(themeToFile(theme)));
  assert.equal(single.error, null);
  assert.equal(single.themes.length, 1);

  const many = parseThemeInput(JSON.stringify(collectionToFile([theme, { ...theme, id: 'other', name: 'Other' }])));
  assert.equal(many.themes.length, 2);
  assert.equal(many.themes[1].name, 'Other');
});

test('junk input reports why rather than failing silently', () => {
  // The message names what Webin will accept, which is now wider than its own format.
  assert.match(parseThemeInput('hello').error, /could not read that/);
  assert.match(parseThemeInput('{"format":"webin-theme","theme":{"name":"x"}}').error, /missing colours/);
});

test('file names are safe and recognisable', () => {
  assert.equal(themeFileName({ name: 'My Theme / v2!' }), 'my-theme-v2.webin.json');
  assert.equal(themeFileName({ name: '   ' }), 'theme.webin.json');
});

test('a theme that says its canvas is not its own gets one worked out', () => {
  // What a glass theme file actually looks like when nobody has translated it: `dark`,
  // near-white ink, a sheet of translucent white for its panels, a brand colour — and
  // `background: transparent`, because the author meant "something behind provides the
  // ground". Refusing the whole file over that one word was pedantry. It names its ink,
  // its panels and its accent, and every one of them points the same way.
  const theme = normaliseTheme({
    name: 'Apple Liquid Glass',
    dark: true,
    palette: {
      background: 'transparent',
      surface: 'rgba(255,255,255,0.075)',
      text: 'rgba(255,255,255,0.96)',
      textMuted: 'rgba(255,255,255,0.60)',
      accent: '#0A84FF',
      onAccent: '#FFFFFF',
      border: 'rgba(255,255,255,0.18)',
    },
  });

  assert.ok(theme, 'a file this complete should not be turned away');
  const ground = parseColor(theme.palette.background);
  assert.equal(ground.a, 1, 'whatever is chosen, it has to actually paint');
  assert.ok(luminance(ground) < 0.1, 'light ink belongs on a dark page');

  // Tinted by the accent rather than a neutral grey: a grey ground under a blue theme
  // reads as a mistake, and the accent is the one colour such a file always has.
  const hue = rgbToHsl(ground).h;
  assert.ok(Math.abs(hue - rgbToHsl(parseColor('#0A84FF')).h) < 6, `${hue} follows the accent`);

  // The translucent sheet is left exactly as written — that is the whole theme.
  assert.equal(theme.palette.surface, 'rgba(255, 255, 255, 0.075)');
});

test('a file that calls itself dark is believed over its own ink', () => {
  // Ink alone is a guess; `dark: true` is the author saying so outright.
  const theme = normaliseTheme({
    dark: true,
    palette: { background: 'transparent', text: '#222222', accent: '#0A84FF', border: '#333' },
  });
  assert.ok(luminance(parseColor(theme.palette.background)) < 0.1, 'the file was taken at its word');
});

test('dark ink with no canvas means a light page', () => {
  const theme = normaliseTheme({
    palette: { background: 'transparent', text: '#111111', accent: '#c2185b', border: '#e0e0e0' },
  });
  assert.ok(luminance(parseColor(theme.palette.background)) > 0.85, 'dark ink belongs on a light page');
});

test('one colour is still not a theme', () => {
  // The line is that a ground can be *worked out* from a palette, not conjured from
  // nothing. A text colour with nothing to stand on has no page to put the text on.
  assert.equal(normaliseTheme({ palette: { text: '#000' } }), null);
  assert.equal(normaliseTheme({ palette: { background: 'transparent', text: '#fff' } }), null,
    'a canvas and ink, where the canvas paints nothing, leaves nothing to reason from');
});

test('a ground that had to be guessed at is reported before anything is saved', () => {
  const { themes, inferred } = parseThemeInput(JSON.stringify({
    name: 'Glass',
    dark: true,
    palette: { background: 'transparent', text: '#ffffff', accent: '#0A84FF', border: '#333' },
  }));
  assert.equal(themes.length, 1);
  assert.ok(inferred.some((note) => note.startsWith('background ←')),
    'the preview can say the canvas was worked out rather than read');
});
